!function(){
  "use strict";
  const __WO_RUNTIME_VERSION="1.0.0";
  if(window.__wardenOneReadyVersion===__WO_RUNTIME_VERSION)return;
  const GRABBER_DOMAINS=["02ip.ru",
  "2no.co",
  "2no.it",
  "account.beauty",
  "barefoot.pics",
  "bc.ax",
  "blasze.com",
  "blasze.tk",
  "bmw.gs",
  "catchify.net",
  "catsnthings.com",
  "catsnthings.fun",
  "cheapcinema.club",
  "cliip.net",
  "cob.soy",
  "crxtra.com",
  "cryp-o.online",
  "crypto-o.click",
  "curiouscat.club",
  "dateing.club",
  "ed.tc",
  "ezstat.ru",
  "foot.wiki",
  "fortnight.space",
  "fortnitechat.site",
  "freegiftcards.co",
  "fvip.info",
  "gamer.hair",
  "gamer.tattoo",
  "gamergirl.pro",
  "gaming-at-my.best",
  "gamingfun.me",
  "gl1tch.me",
  "goo.by",
  "grabb.site",
  "grabify.com",
  "grabify.icu",
  "grabify.link",
  "grabify.org",
  "grabify.world",
  "grabifyicu.com",
  "gyazo.nl",
  "hd.gd",
  "headshot.monster",
  "ikwyd.com",
  "imagehub.fun",
  "imageshare.best",
  "imagevault.cloud",
  "imghost.pics",
  "ip-tracker.org",
  "ip-trap.com",
  "ipgrabber.ru",
  "ipgraber.ru",
  "ipgun.com",
  "iplis.ru",
  "iplist.ru",
  "iplog.co",
  "iplog.network",
  "iplogger.cn",
  "iplogger.co",
  "iplogger.com",
  "iplogger.info",
  "iplogger.org",
  "iplogger.ru",
  "ipsniffer.com",
  "iptrackeronline.com",
  "iptracker.org",
  "lancremasteredpcps.com",
  "joingroups.pro",
  "joinmy.site",
  "leancoding.co",
  "location.cyou",
  "locations.quest",
  "locationtracker.cc",
  "lovebird.guru",
  "map-s.online",
  "maper.info",
  "massive.boats",
  "massive.mom",
  "mymap.icu",
  "mymap.quest",
  "mymassive.store",
  "mymassive.top",
  "mymassive.yachts",
  "myprivate.pics",
  "noodshare.pics",
  "notmy.club",
  "onbit.pro",
  "partpicker.shop",
  "photospace.life",
  "photovault.pics",
  "photovault.store",
  "pichost.pics",
  "picshost.pics",
  "plz.life",
  "programming.monster",
  "ps3cfw.com",
  "quickmessage.us",
  "screenshare.pics",
  "screenshot.best",
  "screensnaps.top",
  "shareit.pics",
  "sharevault.cloud",
  "sherkis.life",
  "shhh.lol",
  "shipment.website",
  "shrekis.life",
  "snifferip.com",
  "sportshub.bar",
  "stonks.boats",
  "stonks.fun",
  "stopify.co",
  "sugma.mom",
  "toes.beauty",
  "trackmyip.cc",
  "truelove.guru",
  "unl.one",
  "urlto.me",
  "whatstheirip.com",
  "wl.gl",
  "xtube.chat",
  "yip.su",
  "yourmy.monster",
  "ythingy.com",
  "yum.mom"],
  ADULT_DOMAINS=["adultfriendfinder.com",
  "ashleymadison.com",
  "beeg.com",
  "bongacams.com",
  "brazzers.com",
  "cam4.com",
  "chaturbate.com",
  "e-hentai.org",
  "en-honeytoon.com",
  "erome.com",
  "fakku.net",
  "fansly.com",
  "fapello.com",
  "hanime.tv",
  "heytoon.net",
  "hentai2read.com",
  "hentaicity.com",
  "hentaifox.com",
  "hentaihaven.xxx",
  "honeytoon.com",
  "honeytoon.site",
  "honeytoons.com",
  "livejasmin.com",
  "motherless.com",
  "myfreecams.com",
  "naughtyamerica.com",
  "nhentai.net",
  "nutaku.net",
  "onlyfans.com",
  "porn.com",
  "pornhub.com",
  "realitykings.com",
  "redtube.com",
  "rule34.xxx",
  "sex.com",
  "spankbang.com",
  "stripchat.com",
  "tnaflix.com",
  "tube8.com",
  "xhamster.com",
  "xnxx.com",
  "xvideos.com",
  "xxx.com",
  "youjizz.com",
  "youporn.com",
  "4tube.com",
  "8muses.com",
  "adultdvdempire.com",
  "adulttime.com",
  "alohatube.com",
  "badoinkvr.com",
  "babes.com",
  "bang.com",
  "bangbros.com",
  "bangtubevideos.com",
  "bdsmlr.com",
  "biqle.ru",
  "bravotube.net",
  "cams.com",
  "camsoda.com",
  "camster.com",
  "camwhores.tv",
  "clips4sale.com",
  "coomer.su",
  "daftsex.com",
  "digitalplayground.com",
  "dirtyship.com",
  "doujins.com",
  "drtuber.com",
  "efukt.com",
  "empflix.com",
  "eporner.com",
  "eroprofile.com",
  "erothots.co",
  "f95zone.to",
  "fancentro.com",
  "fap-nation.com",
  "fapality.com",
  "fetlife.com",
  "flirt4free.com",
  "freeones.com",
  "gotporn.com",
  "hbrowse.com",
  "hclips.com",
  "hdsex.org",
  "heavy-r.com",
  "hentai-foundry.com",
  "hentaihere.com",
  "hentaistream.com",
  "hitomi.la",
  "hqporner.com",
  "imlive.com",
  "jable.tv",
  "javbus.com",
  "javguru.com",
  "javhd.com",
  "javlibrary.com",
  "javmost.com",
  "javtiful.com",
  "jerkmate.com",
  "justfor.fans",
  "kemono.su",
  "leakgirls.com",
  "leaktube.net",
  "literotica.com",
  "lobstertube.com",
  "loyalfans.com",
  "manyvids.com",
  "metart.com",
  "missav.com",
  "missav.ws",
  "mofos.com",
  "mrdeepfakes.com",
  "noodlemagazine.com",
  "nudostar.com",
  "nuvid.com",
  "pichunter.com",
  "porndig.com",
  "porndoe.com",
  "porngo.com",
  "pornhd.com",
  "pornhits.com",
  "porntrex.com",
  "porzo.com",
  "puretaboo.com",
  "redgifs.com",
  "rule34.paheal.net",
  "sexvid.xxx",
  "simpcity.su",
  "slushe.com",
  "spankwire.com",
  "streamate.com",
  "sunporno.com",
  "thothub.to",
  "thumbzilla.com",
  "tsumino.com",
  "txxx.com",
  "vporn.com",
  "vrporn.com",
  "xfantazy.com",
  "xfreehd.com",
  "xhplanet.com",
  "xlovecam.com",
  "xozilla.com",
  "xrares.com",
  "xtube.com",
  "xxxbunker.com",
  "xxxdessert.com",
  "yespornplease.xxx",
  "yuvutu.com"],
  DEFAULTS={
    enabled:!0,
    blockGesturelessNav:!0,
    blockForcedPopups:!0,
    strictPopupShield:!0,
    blockMetaRefresh:!0,
    detectRedirectChains:!0,
    warnGrabberDomains:!0,
    blockGrabberResources:!0,
    blockWebRTCLeak:!0,
    gateAdultSites:!0,
    adultHeuristics:!0,
    warnRedirectParams:!0,
    warnShorteners:!0,
    monitorLoggerApi:!0,
    detectPhishing:!0,
    behavioralScan:!0,
    blockHighConfidencePhishing:!1,
    customBrands:{

    },
    removeOverlays:!0,
    autoSkipDownloadAds:!0,
    blockTrackers:!0,
    trackerLearner:!0,
    adShield:!0,
    googleSearchResultCleanup:!1,
    blockSearchAiAnswers:!1,
    blockSponsoredSearchResults:!1,
    scriptletEngine:!0,
    twitchAdBlock:!0,
    blockAutoplay:!1,
    throttleBackgroundTabs:!1,
    killPrefetch:!1,
    lazyLoadMedia:!1,
    deAmp:!1,
    capReferrer:!1,
    autoRejectConsent:!0,
    sendPrivacySignals:!0,
    antiFingerprintNoise:!1,
    fingerprintProbeDetection:!0,
    blockFingerprintScripts:!0,
    antiFingerprint:!1,
    blockThirdPartyCookies:!0,
    blockAllCookies:!1,
    blockFirstPartyTrackers:!1,
    sessionShield:!0,
    blockTokenExfil:!0,
    continuousTokenScan:!0,
    detectSkimmers:!0,
    paymentCardGuard:!0,
    breachCheck:!1,
    forceHttps:!0,
    downloadSafeBrowsing:!1,
    abuseIpDb:!1,
    openPhish:!1,
    phishTank:!1,
    urlHaus:!1,
    whoisXml:!1,
    whoisXmlReputation:!1,
    whoisXmlThreatIntel:!1,
    downloadReputation:!0,
    clipboardGuard:!1,
    clipboardSwapDetect:!0,
    keystrokePressure:!1,
    honeytokenMode:!1,
    scamLockGuard:!0,
    commandPasteGuard:!0,
    pasteProtection:!0,
    formTrapDetector:!0,
    fakeUpdateDetector:!0,
    riskySiteMode:!0,
    antiClickjacking:!0,
    intranetProtection:!0,
    mediaShield:!0,
    blockCameraMic:!0,
    blockScreenCapture:!0,
    blockGeolocation:!0,
    blockAutoplayMedia:!0,
    blockSuspiciousWebRTC:!1,
    showBadge:!0,
    showDownloadBar:!0,
    showToasts:!0,
    oneOpenPerGesture:!0,
    stripTrackingParams:!0,
    cleanCopyLinks:!0,
    unshimLinks:!0,
    socialWidgetGuard:!0,
    blockSupercookies:!0,
    gestureWindowMs:2400,
    allowlist:[]
  };
  function buildConfig(overrides){
    const cfg=Object.assign({

    },
    DEFAULTS,
    overrides||{

    }),
    host=location.hostname.replace(/^www\./,
    "").toLowerCase(),
    onAllowlist=["wootility.io",
    "shopify.com"].concat(cfg.allowlist||[]).some(h=>host===h||host.endsWith("."+h)),
    masterOn=!1!==cfg.enabled&&!onAllowlist,
    gate=v=>!!masterOn&&v,
    cleanHostList=(list,
    limit,
    payment)=>{
      const out=[],
      seen=new Set,
      max=Math.max(0,
      Number(limit)||0);
      (Array.isArray(list)?list:[]).forEach(d=>{
        if(out.length>=max)return;
        const h=String(d||"").replace(/^www\./,
        "").replace(/^\.+|\.+$/g,
        "").toLowerCase();
        if(!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)||seen.has(h))return;
        if(payment&&(/(^|\.)xn--/i.test(h)||/\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|zip|mov|hair|tattoo)$/i.test(h)||/^[a-f0-9]{12,}$/i.test(h.split(".")[0]||"")))return;
        seen.add(h),
        out.push(h)
      });
      return out
    },
    extraGrabbers=cleanHostList(cfg.grabberDomainsExtra,
    1500,
    !1),
    extraAdults=cleanHostList(cfg.adultDomainsExtra,
    3e3,
    !1),
    extraPaymentHosts=cleanHostList(cfg.trustedPaymentHostsExtra,
    300,
    !0),
    out={
      enabled:masterOn,
      blockGesturelessNav:gate(cfg.blockGesturelessNav),
      blockForcedPopups:gate(cfg.blockForcedPopups),
      strictPopupShield:gate(cfg.strictPopupShield),
      blockMetaRefresh:gate(cfg.blockMetaRefresh),
      detectRedirectChains:gate(cfg.detectRedirectChains),
      warnGrabberDomains:gate(cfg.warnGrabberDomains),
      grabberDomains:masterOn&&(cfg.warnGrabberDomains||cfg.blockGrabberResources)?Array.from(new Set(GRABBER_DOMAINS.concat(extraGrabbers))):[],
      blockGrabberResources:gate(cfg.blockGrabberResources),
      blockWebRTCLeak:gate(cfg.blockWebRTCLeak),
      gateAdultSites:gate(cfg.gateAdultSites),
      adultDomains:masterOn&&cfg.gateAdultSites?Array.from(new Set(ADULT_DOMAINS.concat(extraAdults))):[],
      adultHeuristics:gate(cfg.adultHeuristics),
      warnRedirectParams:gate(cfg.warnRedirectParams),
      warnShorteners:gate(cfg.warnShorteners),
      monitorLoggerApi:gate(cfg.monitorLoggerApi),
      detectPhishing:gate(cfg.detectPhishing),
      behavioralScan:gate(cfg.behavioralScan),
      blockHighConfidencePhishing:gate(cfg.blockHighConfidencePhishing),
      customBrands:cfg.customBrands||{

      },
      removeOverlays:gate(cfg.removeOverlays),
      autoSkipDownloadAds:gate(cfg.autoSkipDownloadAds),
      blockTrackers:gate(cfg.blockTrackers),
      trackerLearner:gate(cfg.trackerLearner),
      adShield:gate(cfg.adShield),
      googleSearchResultCleanup:gate(!0===cfg.googleSearchResultCleanup),
      blockSearchAiAnswers:gate(!0===cfg.blockSearchAiAnswers||!0===cfg.googleSearchResultCleanup),
      blockSponsoredSearchResults:gate(!0===cfg.blockSponsoredSearchResults||!0===cfg.googleSearchResultCleanup),
      scriptletEngine:gate(cfg.scriptletEngine),
      twitchAdBlock:gate(cfg.twitchAdBlock),
      blockAutoplay:gate(cfg.blockAutoplay),
      throttleBackgroundTabs:gate(cfg.throttleBackgroundTabs),
      killPrefetch:gate(cfg.killPrefetch),
      lazyLoadMedia:gate(cfg.lazyLoadMedia),
      deAmp:gate(cfg.deAmp),
      capReferrer:gate(cfg.capReferrer),
      autoRejectConsent:gate(cfg.autoRejectConsent),
      sendPrivacySignals:gate(cfg.sendPrivacySignals),
      antiFingerprintNoise:gate(cfg.antiFingerprintNoise||cfg.antiFingerprint),
      fingerprintProbeDetection:gate(!1!==cfg.fingerprintProbeDetection),
      blockFingerprintScripts:gate(!1!==cfg.blockFingerprintScripts),
      antiFingerprint:gate(cfg.antiFingerprint),
      blockThirdPartyCookies:gate(cfg.blockThirdPartyCookies),
      blockAllCookies:gate(cfg.blockAllCookies),
      blockFirstPartyTrackers:gate(cfg.blockFirstPartyTrackers),
      sessionShield:gate(cfg.sessionShield),
      blockTokenExfil:gate(cfg.blockTokenExfil),
      continuousTokenScan:gate(cfg.continuousTokenScan),
      detectSkimmers:gate(cfg.detectSkimmers),
      paymentCardGuard:gate(!1!==cfg.paymentCardGuard),
      trustedPaymentHostsExtra:gate(!1!==cfg.paymentCardGuard)?extraPaymentHosts:[],
      breachCheck:gate(cfg.breachCheck),
      forceHttps:gate(cfg.forceHttps),
      downloadSafeBrowsing:gate(cfg.downloadSafeBrowsing),
      abuseIpDb:gate(cfg.abuseIpDb),
      openPhish:gate(cfg.openPhish),
      phishTank:gate(cfg.phishTank),
      urlHaus:gate(cfg.urlHaus),
      whoisXml:gate(cfg.whoisXml),
      whoisXmlReputation:gate(cfg.whoisXmlReputation),
      whoisXmlThreatIntel:gate(cfg.whoisXmlThreatIntel),
      downloadReputation:gate(cfg.downloadReputation),
      clipboardGuard:gate(cfg.clipboardGuard),
      clipboardSwapDetect:gate(cfg.clipboardSwapDetect),
      keystrokePressure:gate(cfg.keystrokePressure),
      honeytokenMode:gate(cfg.honeytokenMode),
      scamLockGuard:gate(cfg.scamLockGuard),
      commandPasteGuard:gate(cfg.commandPasteGuard),
      pasteProtection:gate(cfg.pasteProtection),
      formTrapDetector:gate(cfg.formTrapDetector),
      fakeUpdateDetector:gate(cfg.fakeUpdateDetector),
      riskySiteMode:gate(!1!==cfg.riskySiteMode),
      antiClickjacking:gate(!1!==cfg.antiClickjacking),
      intranetProtection:gate(!1!==cfg.intranetProtection),
      mediaShield:gate(cfg.mediaShield),
      blockCameraMic:gate(cfg.blockCameraMic),
      blockScreenCapture:gate(cfg.blockScreenCapture),
      blockGeolocation:gate(!0===cfg.blockGeolocation),
      blockAutoplayMedia:gate(cfg.blockAutoplayMedia),
      blockSuspiciousWebRTC:!1,
      showBadge:cfg.showBadge,
      showDownloadBar:cfg.showDownloadBar,
      showToasts:cfg.showToasts,
      oneOpenPerGesture:cfg.oneOpenPerGesture,
      stripTrackingParams:cfg.stripTrackingParams,
      cleanCopyLinks:gate(!1!==cfg.cleanCopyLinks),
      unshimLinks:gate(cfg.unshimLinks),
      socialWidgetGuard:gate(cfg.socialWidgetGuard),
      blockSupercookies:gate(cfg.blockSupercookies),
      gestureWindowMs:cfg.gestureWindowMs
    };
    if(!masterOn){
      for(const k of Object.keys(out))"gestureWindowMs"!==k&&("customBrands"!==k?Array.isArray(out[k])?out[k]=[]:"boolean"==typeof out[k]&&(out[k]=!1):out[k]={

      });
      out.enabled=!1
    }
    return out
  }
  window.__WO_CONFIG__=buildConfig(null),
  window.__WO_CONFIG__.__configReady=!1;
  let __woToken=null;
  const __woEventQueue=[],
  __woRequestQueue=[],
  __woPendingRequests=new Map;
  function __woEmit(detail){
    if(null!==__woToken)try{
      document.dispatchEvent(new CustomEvent("wo-event",
      {
        detail:Object.assign({
          token:__woToken
        },
        detail)
      }))
    }
    catch(_){

    }
    else __woEventQueue.push(detail)
  }
  function __woDispatchRequest(entry){
    if(null===__woToken)return void __woRequestQueue.push(entry);
    const timeout=setTimeout(()=>{
      const pending=__woPendingRequests.get(entry.id);
      if(pending){
        __woPendingRequests.delete(entry.id);
        try{
          pending.callback({
            ok:!1,
            error:"Timed out waiting for WardenOne bridge."
          })
        }
        catch(_){

        }

      }

    },
    entry.timeoutMs||6e3);
    __woPendingRequests.set(entry.id,
    {
      callback:entry.callback,
      timeout:timeout
    });
    try{
      document.dispatchEvent(new CustomEvent("wo-background-message",
      {
        detail:{
          token:__woToken,
          id:entry.id,
          message:entry.message
        }

      }))
    }
    catch(_){
      clearTimeout(timeout),
      __woPendingRequests.delete(entry.id);
      try{
        entry.callback({
          ok:!1,
          error:"Could not reach WardenOne bridge."
        })
      }
      catch(_){

      }

    }

  }
  function __woBackgroundRequest(message,
  callback,
  timeoutMs){
    __woDispatchRequest({
      id:"rg-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2),
      message:message,
      callback:"function"==typeof callback?callback:()=>{

      },
      timeoutMs:timeoutMs
    })
  }
  window.addEventListener("message",
  e=>{
    if(e.source!==window)return;
    const m=e.data;
    if(!m||"wardenone-bg-response"!==m.source||m.token!==__woToken)return;
    const pending=__woPendingRequests.get(String(m.id||""));
    if(pending){
      __woPendingRequests.delete(String(m.id||"")),
      clearTimeout(pending.timeout);
      try{
        pending.callback(m.result||{
          ok:!1,
          error:"No response from WardenOne."
        })
      }
      catch(_){

      }

    }

  });
  window.addEventListener("message",
  e=>{
    if(e.source!==window)return;
    const m=e.data;
    if(m&&"object"==typeof m)if("wardenone-handshake"!==m.source||"string"!=typeof m.token){
      if("wardenone"===m.source&&"config"===m.kind&&m.overrides){
        if(null===__woToken||m.token!==__woToken)return void __woEmit({
          type:"blocked_config_spoof"
        });
        (overrides=>{
          const prev=window.__WO_CONFIG__||{

          },
          next=buildConfig(overrides);
          Object.assign(prev,
          next),
          prev.__configReady=!0,
          window.__WO_CONFIG__=prev;
          try{
            document.dispatchEvent(new CustomEvent("wo-config-change",
            {
              detail:{
                config:prev
              }

            }))
          }
          catch(_){

          }

        })(m.overrides)
      }

    }
    else null===__woToken&&(__woToken=m.token,
    function(){
      if(null!==__woToken){
        for(;
        __woEventQueue.length;
        ){
          const d=__woEventQueue.shift();
          try{
            document.dispatchEvent(new CustomEvent("wo-event",
            {
              detail:Object.assign({
                token:__woToken
              },
              d)
            }))
          }
          catch(_){

          }

        }
        for(;
        __woRequestQueue.length;
        )__woDispatchRequest(__woRequestQueue.shift())
      }

    }
    ())
  });
  let __woRuntimeStarted=!1;
  const __woStartRuntime=()=>{
    if(__woRuntimeStarted)return;
    __woRuntimeStarted=!0;
    if(window.__wardenOneInstalled===__WO_RUNTIME_VERSION&&window.__wardenOneReadyVersion===__WO_RUNTIME_VERSION)return;
    if(/(^|\.)amazon\.[a-z.]+$/i.test(location.hostname)||/(^|\.)shopify\.com$/i.test(location.hostname)){
      window.__wardenOneInstalled=__WO_RUNTIME_VERSION;
      window.__wardenOneReadyVersion=__WO_RUNTIME_VERSION;
      return
    }
    window.__wardenOneInstalled=__WO_RUNTIME_VERSION;
    const __woMoConsumers=[];
    let __woMoStarted=!1;
    function woObserve(cb){
      if(__woMoConsumers.push(cb),
      !__woMoStarted&&document.documentElement){
        __woMoStarted=!0;
        try{
          new MutationObserver(muts=>{
            for(let i=0;
            i<__woMoConsumers.length;
            i++)try{
              __woMoConsumers[i](muts)
            }
            catch(_){

            }

          }).observe(document.documentElement,
          {
            childList:!0,
            subtree:!0
          })
        }
        catch(_){

        }

      }

    }
    const WO=(()=>{
      const cfg=window.__WO_CONFIG__||{

      },
      host=String(location.hostname||"").replace(/^www\./,
      "").toLowerCase();
      if(/(^|\.)amazon\.[a-z.]+$/i.test(host)){
        const safe=Object.assign({

        },
        cfg);
        for(const k of Object.keys(safe))"boolean"==typeof safe[k]&&(safe[k]=!1);
        return safe.enabled=!1,
        safe.showBadge=!1,
        safe.showToasts=!1,
        safe.__amazonCompatibilityMode=!0,
        safe
      }
      if(!/(^|\.)youtube(-nocookie)?\.com$|(^|\.)youtu\.be$/i.test(location.hostname))return cfg;
      const safe=Object.assign({

      },
      cfg);
      for(const k of Object.keys(safe))"boolean"==typeof safe[k]&&(safe[k]=!1);
      return safe.adShield=!1!==cfg.adShield,
      safe.scriptletEngine=!1!==cfg.scriptletEngine,
      safe.enabled=!1,
      safe.showBadge=!1,
      safe.showToasts=!1,
      safe.__youtubeRecoveryMode=!1,
      safe
    })(),
    WO_TOP=window===window.top,
    regDomain=h=>String(h||"").replace(/^www\./,
    "").toLowerCase(),
    SITE_BOUNDARY=(()=>{
      const normalize=host=>String(host||"").trim().replace(/^www\./,
      "").replace(/^\.+|\.+$/g,
      "").toLowerCase(),
      site=host=>{
        const h=normalize(host),
        parts=h.split(".").filter(Boolean);
        if(parts.length<=2||h.includes(":"))return h;
        const tail=parts.slice(-2).join(".");
        return/^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/i.test(tail)?parts.slice(-3).join("."):tail
      };
      return{
        site:site,
        same:(left,
        right)=>{
          const a=normalize(left),
          b=normalize(right);
          return!!a&&!!b&&(a===b||a.endsWith("."+b)||b.endsWith("."+a))
        },
        siblingCandidate:(left,
        right)=>{
          const a=normalize(left),
          b=normalize(right);
          return!!a&&!!b&&a!==b&&!a.endsWith("."+b)&&!b.endsWith("."+a)&&site(a)===site(b)
        },
        normalize:normalize
      }
    })(),
    VERIFICATION_FLOW_POLICY=(()=>{
      const semantic=/(^|[^a-z])(?:captcha|challenge|verification|verify|human)(?:[^a-z]|$)/i,
      frameHosts=()=>{
        const out=[];
        try{
          const frames=Array.from(document.querySelectorAll("iframe[src]")).slice(0,
          24);
          for(const frame of frames){
            const meta=[frame.getAttribute("title"),
            frame.getAttribute("name"),
            frame.getAttribute("aria-label"),
            frame.getAttribute("src")].filter(Boolean).join(" ");
            if(!semantic.test(meta))continue;
            const rect=frame.getBoundingClientRect();
            if(!rect||rect.width<120||rect.height<40)continue;
            const style="function"==typeof getComputedStyle?getComputedStyle(frame):null;
            if(style&&("none"===style.display||"hidden"===style.visibility||"0"===style.opacity))continue;
            const host=new URL(frame.src,
            location.href).hostname;
            host&&out.push(host)
          }

        }
        catch(_){

        }
        return out
      },
      noticeTargetExpected=(targetHost,
      visibleFrameHosts)=>{
        const frames=Array.isArray(visibleFrameHosts)?visibleFrameHosts:[];
        if(!frames.length)return!1;
        return frames.some(host=>SITE_BOUNDARY.same(host,
        targetHost)||SITE_BOUNDARY.siblingCandidate(host,
        targetHost))
      };
      return{
        frameHosts:frameHosts,
        hasVisibleChallenge:()=>!!frameHosts().length,
        fingerprintNoticePoints:hit=>frameHosts().length?0:Number(hit)>=3?40:10,
        noticeTargetExpected:noticeTargetExpected,
        expectsNoticeUrl:url=>{
          try{
            const target=new URL(url,
            location.href);
            return noticeTargetExpected(target.hostname,
            frameHosts())
          }
          catch(_){
            return!1
          }

        }
      }
    })(),
    isGoogleSearchResults=()=>/(^|\.)google\.[a-z.]+$/i.test(location.hostname)&&/^\/(search|webhp)?$/i.test(location.pathname||"/"),
    isBraveSearchResults=()=>/^search\.brave\.com$/i.test(location.hostname)&&/^\/search$/i.test(location.pathname||"/"),
    CRYPTO_ADDR_RE=/\b(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{20,71}|[LM][a-km-zA-HJ-NP-Z1-9]{26,33}|r[0-9a-zA-Z]{24,34}|T[a-zA-Z0-9]{33}|4[0-9AB][0-9a-zA-Z]{93,104})\b/,
    log=(type,
    detail)=>{
      __woEmit({
        type:type,
        detail:detail,
        at:Date.now()
      })
    },
    safeBrowsingThreatText=verdict=>{
      const threats=Array.isArray(verdict&&verdict.threats)?verdict.threats:[];
      return threats.length?threats.map(t=>String(t||"").replace(/_/g,
      " ").toLowerCase()).join(", "):"known dangerous URL"
    },
    urlReputationOn=()=>!0===WO.downloadSafeBrowsing||!0===WO.phishTank||!0===WO.openPhish||!0===WO.abuseIpDb||!0===WO.urlHaus||!0===WO.whoisXml||!0===WO.whoisXmlReputation||!0===WO.whoisXmlThreatIntel,
    urlReputationProvider=verdict=>String(verdict&&verdict.provider||"URL reputation"),
    reputationWarningType=verdict=>"AbuseIPDB"===urlReputationProvider(verdict)?"warned_abuseipdb_server":"warned_url_reputation",
    logReputationWarning=(type,
    verdict,
    fallbackUrl)=>{
      try{
        if(!verdict||!verdict.warning)return;
        log(type||reputationWarningType(verdict),
        {
          matched:verdict.url||fallbackUrl||"",
          provider:urlReputationProvider(verdict),
          ip:verdict.ip||"",
          score:Number(verdict.score||0),
          domain:verdict.domain||"",
          hostOnly:!!verdict.hostOnly,
          urlCount:Number(verdict.urlCount||0),
          onlineUrlCount:Number(verdict.onlineUrlCount||0),
          reputationScore:null!=verdict.reputationScore?Number(verdict.reputationScore):null,
          ageDays:null!=verdict.ageDays?Number(verdict.ageDays):null,
          domainAgeRisk:verdict.domainAgeRisk||"",
          registrar:verdict.registrar||"",
          domainPrivacy:!!verdict.domainPrivacy,
          warningCodes:verdict.warningCodes||[],
          threatTypes:verdict.threatTypes||[],
          total:Number(verdict.total||0),
          threats:verdict.threats||[],
          why:safeBrowsingThreatText(verdict)
        })
      }
      catch(_){

      }

    },
    safeBrowsingPending=new Map;
    try{
      window.addEventListener("message",
      e=>{
        const m=e&&e.data;
        if(e.source!==window||!m||"wardenone-safe-browsing"!==m.source)return;
        if(null===__woToken||m.token!==__woToken)return;
        const id=String(m.id||""),
        pending=safeBrowsingPending.get(id);
        pending&&(safeBrowsingPending.delete(id),
        pending.resolve(m.result||{
          ok:!1,
          error:"No Safe Browsing response"
        }))
      })
    }
    catch(_){

    }
    const safeBrowsingCheck=(url,
    context,
    timeoutMs)=>{
      if(!urlReputationOn())return Promise.resolve({
        ok:!0,
        enabled:!1,
        hit:!1
      });
      let href="";
      try{
        const u=new URL(String(url||""),
        location.href);
        if("http:"!==u.protocol&&"https:"!==u.protocol)return Promise.resolve({
          ok:!0,
          enabled:!1,
          hit:!1
        });
        u.hash="",
        href=u.href
      }
      catch(_){
        return Promise.resolve({
          ok:!1,
          enabled:!1,
          hit:!1
        })
      }
      return new Promise(resolve=>{
        const id="sb-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2),
        timer=setTimeout(()=>{
          safeBrowsingPending.delete(id),
          resolve({
            ok:!1,
            enabled:!0,
            hit:!1,
            timeout:!0
          })
        },
        timeoutMs||4500);
        safeBrowsingPending.set(id,
        {
          resolve:result=>{
            clearTimeout(timer),
            resolve(result||{
              ok:!1,
              enabled:!0,
              hit:!1
            })
          }

        });
        try{
          document.dispatchEvent(new CustomEvent("wo-safe-browsing-check",
          {
            detail:{
              id:id,
              url:href,
              context:context||"",
              token:__woToken
            }

          }))
        }
        catch(_){
          clearTimeout(timer),
          safeBrowsingPending.delete(id),
          resolve({
            ok:!1,
            enabled:!0,
            hit:!1
          })
        }

      })
    },
    showSafeBrowsingPanel=(title,
    verdict,
    url)=>{
      try{
        const old=document.getElementById("wo-sb-block");
        if(old&&old.remove(),
        !document.body&&!document.documentElement)return;
        const wrap=document.createElement("div");
        wrap.id="wo-sb-block",
        wrap.setAttribute("style",
        "all:initial!important;position:fixed!important;left:50%!important;top:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:460px!important;width:calc(100% - 32px)!important;background:rgba(255,247,247,.99)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;border:2px solid #c0392b!important;border-radius:16px!important;padding:16px 18px!important;box-shadow:0 18px 52px rgba(120,20,20,.4)!important;font-family:Nunito,system-ui,sans-serif!important;");
        const tag=document.createElement("div");
        tag.setAttribute("style",
        "display:inline-block!important;background:rgba(192,57,43,.14)!important;color:#c0392b!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:11px!important;letter-spacing:.04em!important;text-transform:uppercase!important;padding:3px 9px!important;border-radius:8px!important;margin:0 0 8px 0!important;"),
        tag.textContent=urlReputationProvider(verdict),
        wrap.appendChild(tag);
        const h=document.createElement("div");
        h.setAttribute("style",
        "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:14px!important;color:#2d1b40!important;margin:0 0 6px 0!important;"),
        h.textContent=title||"Dangerous URL blocked",
        wrap.appendChild(h);
        const body=document.createElement("div");
        body.setAttribute("style",
        "font-size:12.5px!important;color:#4a3661!important;line-height:1.55!important;margin:0 0 10px 0!important;"),
        body.textContent=urlReputationProvider(verdict)+" flagged this URL as "+safeBrowsingThreatText(verdict)+". WardenOne stopped the action.",
        wrap.appendChild(body);
        const code=document.createElement("div");
        code.setAttribute("style",
        "font-family:ui-monospace,monospace!important;font-size:11px!important;color:#7a2020!important;word-break:break-all!important;background:rgba(192,57,43,.08)!important;border-radius:8px!important;padding:7px 9px!important;margin:0 0 12px 0!important;"),
        code.textContent=String(url||verdict&&verdict.url||"").slice(0,
        240),
        wrap.appendChild(code);
        const btn=document.createElement("button");
        btn.setAttribute("style",
        "width:100%!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
        btn.textContent="Stay here",
        btn.addEventListener("click",
        ()=>{
          try{
            wrap.remove()
          }
          catch(_){

          }

        }),
        wrap.appendChild(btn),
        (document.body||document.documentElement).appendChild(wrap)
      }
      catch(_){

      }

    };
    const PLAYER_ROUTE_RE=/(?:^|[\/_-])(?:watch|episodes?|streams?|videos?|embed|player)(?:[\/_.-]|$)/i,
    PLAYER_FRAMEWORK_SHELL_SELECTOR='.jwplayer,.video-js,.plyr,.plyr__video-wrapper,.plyr__controls,.shaka-video-container,.shaka-controls-container,.shaka-controls-button-panel,[data-shaka-player-container],.dplayer,.art-video-player,.clappr-container',
    PLAYER_SHELL_SELECTOR='[data-player],[data-video],[id="player" i],[id^="player-" i],[id$="-player" i],[class~="player" i],[class~="video-player" i],'+PLAYER_FRAMEWORK_SHELL_SELECTOR,
    PLAYER_PAGE_SELECTOR='video,audio,embed,object,'+PLAYER_SHELL_SELECTOR+',iframe[allow*="autoplay" i],iframe[allowfullscreen],iframe[src*="/embed/" i],iframe[src*="/player/" i]',
    playerShellFor=el=>{
      try{
        return el&&el.closest?el.closest(PLAYER_SHELL_SELECTOR):null
      }
      catch(_){
        return null
      }

    },
    playerFrameworkShellFor=el=>{
      try{
        return el&&el.closest?el.closest(PLAYER_FRAMEWORK_SHELL_SELECTOR):null
      }
      catch(_){
        return null
      }

    },
    playerPageDetected=(()=>{
      let scannedAt=0,
      scanCached=!1;
      return()=>{
        try{
          if(PLAYER_ROUTE_RE.test(location.pathname||""))return!0;
          const now=Date.now();
          if(scannedAt&&now-scannedAt<300)return scanCached;
          scannedAt=now,
          scanCached=!!document.querySelector(PLAYER_PAGE_SELECTOR);
          return scanCached
        }
        catch(_){
          return!1
        }

      }
    })();
    !function(){
      try{
        const host=location.hostname;
        if(!host||"about:"===location.protocol||"chrome:"===location.protocol)return;
        if(window.top!==window.self)return;
        if(/(^|\.)amazon\.[a-z.]+$/i.test(host)){
          try{
            sessionStorage.removeItem("__wo_rl_"+host),
            sessionStorage.removeItem("__wo_rlstop_"+host)
          }
          catch(_){

          }
          return
        }
        const KEY="__wo_rl_"+host,
        STOP_KEY="__wo_rlstop_"+host,
        now=Date.now(),
        WINDOW_MS=6e3,
        THRESHOLD=4;
        let isReload=!1;
        try{
          const nav=performance&&performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];
          isReload=!!(nav&&"reload"===nav.type)
        }
        catch(_){

        }
        if(!isReload){
          try{
            sessionStorage.removeItem(KEY),
            sessionStorage.removeItem(STOP_KEY)
          }
          catch(_){

          }
          return
        }
        let stopped=!1;
        try{
          stopped=now-Number(sessionStorage.getItem(STOP_KEY)||0)<WINDOW_MS
        }
        catch(_){

        }
        let hits=[];
        try{
          hits=JSON.parse(sessionStorage.getItem(KEY)||"[]")
        }
        catch(_){
          hits=[]
        }
        hits=hits.filter(t=>now-t<WINDOW_MS),
        hits.push(now);
        try{
          sessionStorage.setItem(KEY,
          JSON.stringify(hits))
        }
        catch(_){

        }
        if(!(hits.length>=THRESHOLD||stopped))return;
        try{
          sessionStorage.setItem(STOP_KEY,
          String(now))
        }
        catch(_){

        }
        try{
          sessionStorage.removeItem(KEY)
        }
        catch(_){

        }
        log("reload_loop_broken",
        {
          host:host
        });
        try{
          window.stop&&window.stop()
        }
        catch(_){

        }
        const mountNotice=()=>{
          if(document.getElementById("rg-reload-loop"))return;
          const wrap=document.createElement("div");
          wrap.id="rg-reload-loop",
          wrap.setAttribute("style",
          "all:initial!important;position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:440px!important;width:calc(100% - 32px)!important;background:rgba(250,243,253,.97)!important;backdrop-filter:blur(16px)!important;-webkit-backdrop-filter:blur(16px)!important;border:1px solid rgba(176,106,212,.3)!important;border-radius:16px!important;padding:16px 18px!important;box-shadow:0 16px 48px rgba(80,30,110,.35)!important;font-family:Nunito,system-ui,sans-serif!important;");
          const title=document.createElement("div");
          title.setAttribute("style",
          "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:14px!important;color:#2d1b40!important;margin:0 0 5px 0!important;"),
          title.textContent="Stopped a reload loop",
          wrap.appendChild(title);
          const body=document.createElement("div");
          body.setAttribute("style",
          "font-size:12.5px!important;color:#6a5685!important;line-height:1.5!important;margin:0 0 12px 0!important;"),
          body.textContent="This site keeps reloading because WardenOne is blocking its cookies and it can't start a session. Cookies are still blocked. You can allow cookies just for this site to use it normally.",
          wrap.appendChild(body);
          const row=document.createElement("div");
          row.setAttribute("style",
          "display:flex!important;gap:8px!important;flex-wrap:wrap!important;");
          const allow=document.createElement("button");
          allow.setAttribute("style",
          "flex:none!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:10px!important;padding:9px 15px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          allow.setAttribute("data-wo-cookie-allow",
          "1"),
          allow.textContent="Allow cookies here",
          allow.addEventListener("click",
          e=>{
            if(!e||!1!==e.isTrusted)try{
              allow.disabled=!0,
              allow.textContent="Allowing..."
            }
            catch(_){

            }

          }),
          row.appendChild(allow);
          const dismiss=document.createElement("button");
          dismiss.setAttribute("style",
          "flex:none!important;border:1px solid rgba(176,106,212,.3)!important;cursor:pointer!important;background:rgba(176,106,212,.1)!important;color:#7a5f93!important;border-radius:10px!important;padding:9px 15px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          dismiss.textContent="Keep blocked",
          dismiss.addEventListener("click",
          ()=>{
            try{
              wrap.remove()
            }
            catch(_){

            }

          }),
          row.appendChild(dismiss),
          wrap.appendChild(row),
          (document.body||document.documentElement).appendChild(wrap)
        };
        document.body?mountNotice():document.addEventListener("DOMContentLoaded",
        mountNotice,
        {
          once:!0
        })
      }
      catch(_){

      }

    }
    ();
    const TRACKING_PARAMS=[/^utm_/i,
    /^fbclid$/i,
    /^gclid$/i,
    /^dclid$/i,
    /^msclkid$/i,
    /^mc_eid$/i,
    /^mc_cid$/i,
    /^igshid$/i,
    /^_hsenc$/i,
    /^_hsmi$/i,
    /^yclid$/i,
    /^_openstat$/i,
    /^twclid$/i,
    /^spm$/i],
    toURL=(h,
    b)=>{
      try{
        return new URL(h,
        b||location.href)
      }
      catch{
        return null
      }

    },
    siteKey=h=>{
      const parts=regDomain(h).split(".").filter(Boolean);
      if(parts.length<=2)return parts.join(".");
      const last2=parts.slice(-2).join(".");
      return/^(ac|co|com|edu|gov|net|org|gob|gouv)\.[a-z]{2}$/.test(last2)?parts.slice(-3).join("."):last2
    },
    sameSite=(a,
    b)=>{
      const ua=toURL(a),
      ub=toURL(b);
      return!(!ua||!ub)&&siteKey(ua.hostname)===siteKey(ub.hostname)
    },
    isFederatedAuthTarget=raw=>{
      try{
        const u=toURL(raw);
        if(!u||"https:"!==u.protocol)return!1;
        const host=regDomain(u.hostname),
        path=(u.pathname+u.search).toLowerCase();
        if(/(^|\.)(accounts\.google\.com|oauth2\.googleapis\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|okta\.com|oktacdn\.com|oktapreview\.com|okta-emea\.com|auth0\.com|onelogin\.com|duosecurity\.com|openathens\.net|shibboleth\.net|pingidentity\.com|pingone\.(com|eu|asia|ca)|forgerock\.(io|com)|b2clogin\.com|ciamlogin\.com|amazoncognito\.com)$/.test(host))return!0;
        if(["samlrequest",
        "samlresponse",
        "relaystate",
        "wresult",
        "wctx",
        "wtrealm",
        "id_token",
        "access_token"].some(k=>u.searchParams.has(k)))return!0;
        if(u.searchParams.has("client_id")&&(u.searchParams.has("redirect_uri")||u.searchParams.has("response_type")||u.searchParams.has("scope")))return!0;
        if(u.searchParams.has("code")&&u.searchParams.has("state"))return!0;
        return/(^|\.)(login|auth|sso|idp|identity|accounts?|signin|sts)[.-]/i.test(host)&&/(oauth|openid|saml|authorize|accountchooser|sign[/-]?in|log[/-]?in|federat|callback)/i.test(path)
      }
      catch(_){
        return!1
      }
    },
    isHighRiskNavigationTarget=raw=>{
      try{
        const u=toURL(raw);
        if(!u||!/^https?:$/.test(u.protocol))return!1;
        const host=regDomain(u.hostname),
        text=u.href;
        if(((window.__WO_CONFIG__&&window.__WO_CONFIG__.grabberDomains)||[]).some(d=>host===d||host.endsWith("."+d)))return!0;
        if(/(^|\.)(popads|popcash|propellerads|adsterra|hilltopads|exoclick|trafficjunky|clickadu|ad-maven|admaven|onclickads|popunder[a-z]*|bidvertiser|clickaine|adskeeper|galaksion)\./i.test(host))return!0;
        return/(adurl|popunder|onclickad|affiliate|utm_source=ad|doubleclick|adservice)/i.test(text)&&/\.(zip|mov|cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|monster|lol)$/i.test(host)
      }
      catch(_){
        return!1
      }
    },
    COPY_CLEAN_GLOBAL=/^(utm_\w*|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|igshid|igsh|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsCtaTracking|yclid|_openstat|twclid|ttclid|spm|gclsrc|wbraid|gbraid|srsltid|sca_esv|gad_source|gad_campaignid|gcl_aw|gcl_dc|li_fat_id|_branch_match_id|_branch_referrer|vero_id|vero_conv|_ga|_gl|mkt_tok|epik|rb_clickid|irclickid|irgwc|zanpid|oly_anon_id|oly_enc_id|ml_subscriber|ml_subscriber_hash|mtm_\w*|pk_(campaign|kwd|source|medium)|fb_(action_ids|action_types|ref|source)|soc_src|soc_trk|wicked(id|source)|_kx|elq(track(id)?|campaignid|aid|at)|trk_(contact|msg|module|sid)|at_medium|at_campaign|cmpid|WT\.\w+)$/i,
    COPY_CLEAN_SITES=[[/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i,
    /^(si|feature|pp|embeds_referring_euri|source_ve_path|app|persist_app)$/i],
    [/(^|\.)open\.spotify\.com$/i,
    /^(si|context|nd|_branch_match_id|_branch_referrer)$/i],
    [/(^|\.)amazon\.[a-z.]+$/i,
    /^(ref|ref_\w*|tag|linkCode|linkId|ascsubtag|creative|creativeASIN|camp|adid|pd_rd_\w+|pf_rd_\w+|qid|sr|srs|crid|sprefix|dib|dib_tag|keywords|content-id|social_share|starsLeft|skipTwisterOG|_encoding|smid|psc)$/i],
    [/(^|\.)(x|twitter)\.com$/i,
    /^(s|t|ref_src|ref_url)$/i],
    [/(^|\.)instagram\.com$/i,
    /^(igsh|igshid|ig_mid|ig_rid)$/i],
    [/(^|\.)tiktok\.com$/i,
    /^(_r|_t|u_code|share_app_id|share_link_id|sender_device|sender_web_id|is_from_webapp|is_copy_url|checksum|tt_from|refer|share_author_id)$/i],
    [/(^|\.)reddit\.com$/i,
    /^(rdt|share_id|ref|ref_source|ref_campaign|correlation_id)$/i],
    [/(^|\.)ebay\.[a-z.]+$/i,
    /^(mkcid|mkevt|mkrid|campid|toolid|customid|mkpid|ssspo|sssrc|ssuid|widget_ver|_trkparms|_trksid)$/i],
    [/(^|\.)aliexpress\.[a-z.]+$/i,
    /^(scm|scm_id|scm-url|pdp_npi|sourceType|gatewayAdapt|aff_\w+|terminal_id|afSmartRedirect|utparam-url)$/i],
    [/(^|\.)linkedin\.com$/i,
    /^(trk|trkInfo|li_fat_id|refId|trackingId|midToken|midSig|trkEmail|lipi)$/i],
    [/(^|\.)facebook\.com$/i,
    /^(__cft__.*|__tn__|mibextid|sfnsn|extid|rdid|paipv|eav|comment_tracking|notif_id|notif_t)$/i],
    [/^(www\.)?google\.[a-z.]+$/i,
    /^(ved|ei|sa|usg|sxsrf|sourceid|gs_lp|gs_lcrp|gs_ssp|aqs|sclient|uact|iflsig|rlz|oq|prmd|biw|bih|opi)$/i]],
    COPY_REDIRECT_SITES=[
      [/(^|\.)google\.[a-z.]+$|(^|\.)googleusercontent\.com$/i,
      /^\/(url|imgres|aclk)$/i,
      ["url",
      "q",
      "adurl"]],
      [/(^|\.)youtube\.com$/i,
      /^\/redirect$/i,
      ["q",
      "url"]],
      [/(^|\.)(facebook|messenger)\.com$|(^|\.)instagram\.com$|(^|\.)l\.facebook\.com$/i,
      /\/(l\.php|flx\/warn\/?)/i,
      ["u"]],
      [/(^|\.)out\.reddit\.com$/i,
      /^\/?/i,
      ["url"]],
      [/(^|\.)reddit\.com$/i,
      /\/out/i,
      ["url"]],
      [/(^|\.)linkedin\.com$/i,
      /^\/safety\/go/i,
      ["url"]],
      [/(^|\.)steamcommunity\.com$/i,
      /^\/linkfilter\//i,
      ["url"]],
      [/(^|\.)duckduckgo\.com$/i,
      /^\/l\//i,
      ["uddg"]],
      [/(^|\.)safelinks\.protection\.outlook\.com$/i,
      /^\/?/i,
      ["url"]]],
    decodeCopyUrlValue=v=>{
      const s=String(v||"").trim();
      if(!s)return"";
      try{
        const d=decodeURIComponent(s);
        if(/^https?:\/\//i.test(d))return d
      }
      catch(_){

      }
      return s
    },
    copyRedirectTarget=u=>{
      try{
        const host=String(u.hostname||"").toLowerCase();
        for(const[hre,
        pre,
        params]of COPY_REDIRECT_SITES){
          if(!hre.test(host)||!pre.test(u.pathname))continue;
          for(const p of params){
            const raw=u.searchParams.get(p);
            if(!raw)continue;
            const candidate=decodeCopyUrlValue(raw);
            if(!/^https?:\/\//i.test(candidate))continue;
            const dest=toURL(candidate);
            if(dest&&/^https?:$/i.test(dest.protocol)&&dest.hostname.toLowerCase()!==host)return dest.toString()
          }
        }
      }
      catch(_){

      }
      return""
    },
    cleanCopyUrl=raw=>{
      try{
        const normalized=String(raw||"").replace(/&amp;/gi,
        "&"),
        u=toURL(normalized);
        if(!u||!/^https?:$/i.test(u.protocol))return raw;
        const redirected=copyRedirectTarget(u);
        if(redirected)return cleanCopyUrl(redirected);
        const host=String(u.hostname||"").toLowerCase();
        let siteRe=null;
        for(const[hre,
        pre]of COPY_CLEAN_SITES)if(hre.test(host)){
          siteRe=pre;
          break
        }
        siteRe&&/^(www\.)?google\./i.test(host)&&/^\/(url|imgres)$/i.test(u.pathname)&&(siteRe=null);
        let changed=!1;
        for(const key of[...u.searchParams.keys()])(TRACKING_PARAMS.some(re=>re.test(key))||COPY_CLEAN_GLOBAL.test(key)||siteRe&&siteRe.test(key))&&(u.searchParams.delete(key),
        changed=!0);
        if(/(^|\.)amazon\.[a-z.]+$/i.test(host)&&/\/ref=[^/?#]*/i.test(u.pathname)){
          u.pathname=u.pathname.replace(/\/ref=[^/?#]*/gi,
          ""),
          changed=!0
        }
        if(/(^|\.)amazon\.[a-z.]+$/i.test(host)){
          const m=u.pathname.match(/\/(?:[^/?#]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
          m&&(u.pathname="/dp/"+m[1],
          changed=!0)
        }
        return changed?u.toString():raw
      }
      catch(_){
        return raw
      }

    },
    cleanCopyText=text=>{
      try{
        const s=String(text||"");
        if(!s||s.length>2e5||-1===s.indexOf("http"))return s;
        return s.replace(/https?:\/\/[^\s<>"')\]]+/g,
        m=>{
          const tail=(m.match(/[.,;:!?]+$/)||[""])[0],
          core=tail?m.slice(0,
          -tail.length):m;
          return cleanCopyUrl(core)+tail
        })
      }
      catch(_){
        return String(text||"")
      }

    },
    REAL={
      reload:location.reload.bind(location),
      assign:location.assign.bind(location),
      back:history.back.bind(history),
      hrefSet:(()=>{
        try{
          const d=Object.getOwnPropertyDescriptor(Location.prototype,
          "href")||Object.getOwnPropertyDescriptor(window.location,
          "href");
          return d&&d.set?d.set.bind(location):null
        }
        catch{
          return null
        }

      })()
    },
    realGoBack=()=>{
      if(WO.__frozen=!1,
      history.length>1)try{
        return void REAL.back()
      }
      catch{

      }
      (url=>{
        if(WO.__frozen=!1,
        REAL.hrefSet)try{
          return void REAL.hrefSet(url)
        }
        catch{

        }
        try{
          REAL.assign(url)
        }
        catch{
          location.href=url
        }

      })("about:blank")
    },
    S=(el,
    css)=>(el.setAttribute("style",
    css),
    el),
    buildOverlay=(id,
    bg)=>{
      const host=document.createElement("div");
      return host.id=id,
      S(host,
      "all:initial!important;position:fixed!important;inset:0!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;margin:0!important;padding:24px!important;box-sizing:border-box!important;background:"+bg+"!important;display:flex!important;align-items:center!important;justify-content:center!important;font-family:system-ui,-apple-system,sans-serif!important;visibility:visible!important;opacity:1!important;transform:none!important;"),
      host
    },
    oDiv=(parent,
    css,
    text)=>{
      const d=document.createElement("div");
      return S(d,
      css),
      null!=text&&(d.textContent=String(text)),
      parent.appendChild(d),
      d
    },
    oTextDiv=(parent,
    css,
    text)=>{
      const d=document.createElement("div");
      return S(d,
      css),
      d.textContent=null==text?"":String(text),
      parent.appendChild(d),
      d
    },
    appendText=(parent,
    text)=>(parent.appendChild(document.createTextNode(String(null==text?"":text))),
    parent),
    appendBold=(parent,
    text)=>{
      const b=document.createElement("b");
      return b.textContent=String(null==text?"":text),
      parent.appendChild(b),
      b
    },
    clearNode=node=>{
      try{
        for(;
        node&&node.firstChild;
        )node.removeChild(node.firstChild)
      }
      catch(_){

      }
      return node
    },
    svgNode=(tag,
    attrs)=>{
      const n=document.createElementNS("http://www.w3.org/2000/svg",
      tag);
      return Object.keys(attrs||{

      }).forEach(k=>n.setAttribute(k,
      attrs[k])),
      n
    },
    appendShieldSvg=(parent,
    kind)=>{
      const svg=svgNode("svg",
      {
        width:"check-soft"===kind?"19":"20",
        height:"check-soft"===kind?"19":"20",
        viewBox:"0 0 24 24",
        fill:"none"
      });
      if("check-soft"===kind)svg.appendChild(svgNode("path",
      {
        d:"M12 2.5c2.6 1.4 5 1.8 7 1.9.3 4.9-.6 11.3-7 15.1C5.6 15.7 4.7 9.3 5 4.4c2 0 4.4-.5 7-1.9z",
        fill:"#fff",
        "fill-opacity":"0.25"
      })),
      svg.appendChild(svgNode("path",
      {
        d:"M8.3 12.2l2.6 2.6 5-5.6",
        stroke:"#fff",
        "stroke-width":"2.2",
        "stroke-linecap":"round",
        "stroke-linejoin":"round"
      }));
      else svg.appendChild(svgNode("path",
      {
        d:"M12 3l7 3v5c0 4.2-2.9 7.4-7 8.5-4.1-1.1-7-4.3-7-8.5V6l7-3z",
        fill:"#fff",
        opacity:"0.95"
      })),
      svg.appendChild(svgNode("path",
      {
        d:"check"===kind?"M9 12l2 2 4-4.5":"M12 7v6",
        stroke:"#b06ad4",
        "stroke-width":"2",
        "stroke-linecap":"round",
        "stroke-linejoin":"check"===kind?"round":""
      })),
      "alert"===kind&&svg.appendChild(svgNode("circle",
      {
        cx:"12",
        cy:"16",
        r:"1.25",
        fill:"#b06ad4"
      }));
      return parent.appendChild(svg),
      svg
    },
    oBtn=(parent,
    css,
    text,
    onClick)=>{
      const b=document.createElement("button"),
      fire=e=>{
        try{
          e&&e.preventDefault(),
          e&&e.stopPropagation()
        }
        catch(_){

        }
        try{
          "function"==typeof onClick&&onClick(e)
        }
        catch(_){

        }

      };
      return b.type="button",
      "string"==typeof text&&"x"===text.toLowerCase()&&(b.setAttribute("aria-label",
      "Close notification"),
      b.title="Close"),
      S(b,
      "all:unset!important;box-sizing:border-box!important;cursor:pointer!important;pointer-events:auto!important;touch-action:manipulation!important;user-select:none!important;display:inline-block!important;text-align:center!important;"+css),
      b.textContent=text,
      b.addEventListener("click",
      fire,
      !0),
      parent.appendChild(b),
      b
    },
    mountBlocker=(id,
    paint)=>{
      const styleId=id+"-style",
      ensureStyle=()=>{
        if(document.getElementById(styleId))return;
        const st=document.createElement("style");
        st.id=styleId,
        st.textContent="html > body > *:not(#"+id+"){display:none!important;visibility:hidden!important}body{overflow:hidden!important;background:#0a0a0f!important}#"+id+"{display:flex!important;visibility:visible!important}",
        (document.head||document.documentElement).appendChild(st)
      },
      ensureOverlay=()=>{
        if(!document.getElementById(id))try{
          paint()
        }
        catch(_){

        }

      };
      ensureStyle(),
      ensureOverlay();
      let obs=null,
      remounts=0,
      scheduled=!1;
      const check=()=>{
        if(scheduled=!1,
        !document.getElementById(id)||!document.getElementById(styleId)){
          if(remounts++>60)try{
            obs&&obs.disconnect()
          }
          catch(_){

          }
          ensureStyle(),
          ensureOverlay()
        }

      };
      try{
        obs=new MutationObserver(()=>{
          scheduled||(scheduled=!0,
          requestAnimationFrame(check))
        }),
        obs.observe(document.documentElement,
        {
          childList:!0,
          subtree:!0
        })
      }
      catch(_){

      }
      const obsTimeout=setTimeout(()=>{
        try{
          obs&&obs.disconnect()
        }
        catch(_){

        }

      },
      1e4);
      return()=>{
        try{
          obs&&obs.disconnect()
        }
        catch(_){

        }
        clearTimeout(obsTimeout);
        const o=document.getElementById(id);
        o&&o.remove();
        const s=document.getElementById(styleId);
        s&&s.remove(),
        WO.__frozen=!1
      }

    };
    if(WO.gateAdultSites&&Array.isArray(WO.adultDomains)&&WO.adultDomains.length){
      const here=regDomain(location.hostname),
      onList=WO.adultDomains.find(d=>here===d||here.endsWith("."+d));
      let heuristicHit=!1,
      heuristicReasons=[];
      if(WO.adultHeuristics&&!onList){
        const host=here,
        STRONG_LONG=/(xvideos|xnxx|xhamster|hentai|camgirl|camsex|sexcam|cumshot|creampie|gangbang|deepthroat|bukkake|onlyfans|rule34|pornhub|brazzers|shemale|blowjob|handjob|cumming)/i,
        STRONG_SHORT=/(^|[-_.0-9])(milf|bdsm|nsfw|xxx|jizz|fap)([-_.0-9]|$)/i,
        STRONG_COMPOUND=/(livecam|webcamsex|camwhore|camslut|sexcams?|adultcams?|livesex|freesex|xxxcam|nudecam|sexchat|adultchat|fuckbook|shagbook|milfcam)/i,
        PORN_SUBSTR=/porn/i,
        SFW_PORN=/(food|earth|nature|space|sky|cloud|weather|city|room|interior|home|history|design|architect|car|auto|gun|book|word|data|tech|plant|animal|cabin|mountain|abandoned|machine|monster|map|retro|train|aviation|military|gaming|hardware|kitchen|garden|coffee|watch)[-_]?porn/i,
        STRONG_HOST={
          test:h=>STRONG_LONG.test(h)||STRONG_SHORT.test(h)||STRONG_COMPOUND.test(h)||PORN_SUBSTR.test(h)&&!SFW_PORN.test(h)
        },
        SOFT_HOST=/(^|[-_.])(sex|adult|nude|naked|erotic|lust|kink|babe|escort|fetish|cam|girl)(s|sex|cam|girl|videos?)?([-_.0-9]|$)/i;
        let score=0;
        /\.(xxx|porn|sex|adult|sexy|cam|tube|webcam|porno)$/i.test(host)&&(score+=3,
        heuristicReasons.push("adult TLD")),
        STRONG_HOST.test(host)?(score+=4,
        heuristicReasons.push("explicit term in domain")):SOFT_HOST.test(host)&&(score+=1,
        heuristicReasons.push("suggestive term in domain"));
        const checkTitle=()=>{
          try{
            const t=(document.title||"").toLowerCase();
            if(/(porn|hentai|xxx|nsfw|sex videos?|free porn|adult videos?|live cams?|camgirls?)/i.test(t))return 4
          }
          catch{

          }
          return 0
        };
        score+=checkTitle(),
        score>=4?heuristicHit=!0:score>=1&&document.addEventListener("DOMContentLoaded",
        ()=>{
          if(WO.__adultGateShown)return;
          const extra=checkTitle();
          score+extra>=4&&maybeGateAdult(!0,
          heuristicReasons.concat("explicit title"))
        })
      }
      let adultReaskForceHeuristic=!1,
      adultReaskReasons=heuristicReasons;
      function armAdultGateReask(forceHeuristic,
      reasonsIn){
        adultReaskForceHeuristic=!!forceHeuristic,
        adultReaskReasons=reasonsIn||heuristicReasons,
        WO.__adultGateReaskBound||(WO.__adultGateReaskBound=!0,
        window.addEventListener("pagehide",
        ()=>{
          WO.__adultGateAllowedThisPage=!1,
          WO.__adultGateShown=!1
        }),
        window.addEventListener("pageshow",
        e=>{
          e.persisted&&(WO.__adultGateAllowedThisPage=!1,
          WO.__adultGateShown=!1,
          setTimeout(()=>maybeGateAdult(adultReaskForceHeuristic,
          adultReaskReasons),
          0))
        }))
      }
      function maybeGateAdult(forceHeuristic,
      reasonsIn){
        if(WO.__adultGateShown)return;
        let refHost="";
        try{
          refHost=document.referrer?regDomain(new URL(document.referrer).hostname):""
        }
        catch{

        }
        const cameFromElsewhere=refHost&&refHost!==here&&!here.endsWith("."+refHost)&&!refHost.endsWith("."+here);
        if(!0!==WO.__adultGateAllowedThisPage&&(cameFromElsewhere||!refHost)){
          armAdultGateReask(forceHeuristic,
          reasonsIn),
          WO.__frozen=!0;
          const CARD="background:rgba(250,243,253,.94)!important;color:#3d2a52!important;max-width:560px!important;width:100%!important;border:1px solid rgba(176,106,212,.28)!important;border-radius:20px!important;padding:30px!important;text-align:left!important;backdrop-filter:blur(20px) saturate(1.25)!important;-webkit-backdrop-filter:blur(20px) saturate(1.25)!important;box-shadow:0 24px 70px rgba(80,30,110,.4)!important;font-family:Quicksand,Nunito,system-ui,sans-serif!important;",
          TITLE_ROW="display:flex!important;align-items:center!important;gap:11px!important;margin:0 0 10px 0!important;",
          BADGE="flex:none!important;width:38px!important;height:38px!important;border-radius:11px!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;display:flex!important;align-items:center!important;justify-content:center!important;box-shadow:0 6px 16px rgba(176,106,212,.4)!important;",
          H1="font-size:19px!important;font-weight:700!important;color:#2d1b40!important;margin:0!important;font-family:Quicksand,system-ui,sans-serif!important;",
          SUB="color:#7a5f93!important;margin:0 0 10px 0!important;font-size:13.5px!important;line-height:1.55!important;font-family:Nunito,system-ui,sans-serif!important;",
          HOSTBOX="font-family:ui-monospace,monospace!important;font-size:12px!important;color:#5a4570!important;background:rgba(176,106,212,.08)!important;border:1px solid rgba(176,106,212,.2)!important;border-radius:10px!important;padding:10px 12px!important;margin:8px 0 14px 0!important;display:block!important;word-break:break-all!important;",
          BTNROW="display:flex!important;gap:10px!important;margin-top:20px!important;justify-content:flex-start!important;flex-wrap:wrap!important;",
          BLEAVE="background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:11px!important;padding:11px 18px!important;font-size:13.5px!important;font-weight:700!important;font-family:Quicksand,system-ui,sans-serif!important;box-shadow:0 6px 16px rgba(176,106,212,.35)!important;",
          BGO="background:rgba(176,106,212,.12)!important;color:#7a5f93!important;border:1px solid rgba(176,106,212,.25)!important;border-radius:11px!important;padding:11px 18px!important;font-size:13.5px!important;font-weight:700!important;font-family:Quicksand,system-ui,sans-serif!important;",
          FINE="color:#a98fc0!important;font-size:11px!important;margin-top:14px!important;line-height:1.4!important;font-family:Nunito,system-ui,sans-serif!important;";
          let teardown=null;
          const paint=()=>{
            const host=buildOverlay("rg-adult-gate",
            "rgba(38,20,54,.55)"),
            card=oDiv(host,
            CARD),
            titleRow=oDiv(card,
            TITLE_ROW);
            appendShieldSvg(oDiv(titleRow,
            BADGE),
            "alert"),
            oDiv(titleRow,
            H1,
            "Adult site ahead");
            const msg=oDiv(card,
            SUB,
            "WardenOne paused this adult (18+) site before it loaded.");
            cameFromElsewhere&&(appendText(msg,
            " You were redirected here"),
            refHost&&(appendText(msg,
            " from "),
            appendBold(msg,
            refHost)),
            appendText(msg,
            ".")),
            oTextDiv(card,
            HOSTBOX,
            here),
            oDiv(card,
            SUB,
            "If you didn't mean to come here, leave now.");
            const btns=oDiv(card,
            BTNROW);
            oBtn(btns,
            BLEAVE,
            "<- Take me back",
            ()=>{
              teardown&&teardown(),
              realGoBack()
            }),
            oBtn(btns,
            BGO,
            "I'm sure, continue",
            ()=>{
              WO.__adultGateAllowedThisPage=!0,
              teardown&&teardown()
            }),
            oDiv(card,
            FINE,
            "Shown because you arrived via a redirect or external link, not by browsing here directly."),
            document.documentElement.appendChild(host)
          };
          teardown=mountBlocker("rg-adult-gate",
          paint),
          WO.__adultGateShown=!0,
          log("gated_adult_site",
          {
            host:here,
            from:refHost||"(none)",
            via:onList?"list":"heuristic",
            reasons:onList?["known adult domain"]:reasonsIn||heuristicReasons
          })
        }

      }
      (onList||heuristicHit)&&maybeGateAdult(!1,
      heuristicReasons)
    }
    let unshimLogCount=0;
    function stripTracking(href){
      if(href=function(href){
        if(!WO.unshimLinks)return href;
        const u=toURL(href);
        if(!u||!/^https?:$/i.test(u.protocol))return href;
        const host=u.hostname.replace(/^www\./,
        "").toLowerCase(),
        path=u.pathname.toLowerCase();
        let raw="";
        if((/^(.+\.)?google\.[a-z.]+$/i.test(host)||/(^|\.)googleusercontent\.com$/i.test(host))&&/^\/(url|imgres|aclk)$/i.test(path)?raw=u.searchParams.get("url")||u.searchParams.get("q")||u.searchParams.get("adurl")||"":(/(^|\.)(facebook|messenger)\.com$/i.test(host)||/(^|\.)instagram\.com$/i.test(host))&&(/\/l\.php$/i.test(path)||/\/flx\/warn\//i.test(path))&&(raw=u.searchParams.get("u")||""),
        !raw)return href;
        const dest=toURL(raw,
        location.href);
        return dest&&/^https?:$/i.test(dest.protocol)&&dest.hostname.toLowerCase()!==u.hostname.toLowerCase()?(++unshimLogCount<=20&&log("unshimmed_link",
        {
          from:u.hostname,
          to:dest.hostname
        }),
        dest.toString()):href
      }
      (href),
      !WO.stripTrackingParams)return href;
      const u=toURL(href);
      if(!u)return href;
      let changed=!1;
      for(const key of[...u.searchParams.keys()])TRACKING_PARAMS.some(re=>re.test(key))&&(u.searchParams.delete(key),
      changed=!0);
      let out=changed?u.toString():href;
      if(!0===WO.cleanCopyLinks){
        const c2=cleanCopyUrl(out);
        c2!==out&&(out=c2)
      }
      return out
    }
    const scrubDomLink=el=>{
      try{
        if(!WO.unshimLinks&&!WO.stripTrackingParams||!el||!el.tagName)return;
        if("A"===el.tagName||"AREA"===el.tagName){
          const old=el.getAttribute("href");
          if(!old)return;
          const cleaned=stripTracking(old);
          cleaned!==old&&el.setAttribute("href",
          cleaned)
        }
        else if("FORM"===el.tagName){
          const old=el.getAttribute("action")||el.action||"";
          if(!old)return;
          const cleaned=stripTracking(old);
          cleaned!==old&&el.setAttribute("action",
          cleaned)
        }

      }
      catch(_){

      }

    },
    sweepDomLinks=root=>{
      try{
        if(!WO.unshimLinks&&!WO.stripTrackingParams)return;
        (root||document).querySelectorAll("a[href],area[href],form[action]").forEach(scrubDomLink)
      }
      catch(_){

      }

    };
    document.documentElement&&sweepDomLinks(document);
    try{
      woObserve(muts=>{
        for(const mu of muts)for(const n of mu.addedNodes)n&&n.tagName&&scrubDomLink(n),
        n&&n.querySelectorAll&&sweepDomLinks(n)
      }),
      document.addEventListener("wo-config-change",
      ()=>sweepDomLinks(document))
    }
    catch(_){

    }
    try{
      let cleanCopyLogCount=0;
      const noteCleanCopy=()=>{
        ++cleanCopyLogCount<=20&&log("cleaned_copied_link",
        {

        })
      };
      window.addEventListener("copy",
      e=>{
        try{
          if(!0!==WO.cleanCopyLinks)return;
          const cd=e.clipboardData;
          if(!cd)return;
          let text="";
          if(e.defaultPrevented){
            try{
              text=String(cd.getData("text/plain")||"")
            }
            catch(_){
              text=""
            }
            if(!text)return
          }
          else{
            const ae=document.activeElement;
            if(ae&&/^(INPUT|TEXTAREA)$/.test(ae.tagName||"")&&"number"==typeof ae.selectionStart&&ae.selectionEnd>ae.selectionStart)text=String(ae.value||"").slice(ae.selectionStart,
            ae.selectionEnd);
            else text=String(document.getSelection?document.getSelection():"")
          }
          if(!text||-1===text.indexOf("http"))return;
          const cleaned=cleanCopyText(text);
          cleaned!==text&&(cd.setData("text/plain",
          cleaned),
          e.preventDefault(),
          noteCleanCopy())
        }
        catch(_){

        }

      });
      if(navigator.clipboard&&navigator.clipboard.writeText){
        const realCleanWT=navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText=function(text){
          try{
            if(!0===WO.cleanCopyLinks&&"string"==typeof text){
              const cleaned=cleanCopyText(text);
              if(cleaned!==text)return noteCleanCopy(),
              realCleanWT(cleaned)
            }

          }
          catch(_){

          }
          return realCleanWT(text)
        }

      }

    }
    catch(_){

    }
    let lastGestureAt=0,
    gestureSpent=!1,
    lastLoginIntentAt=0;
    const gestureWindowMs=()=>Number((window.__WO_CONFIG__||WO).gestureWindowMs)||2400,
    loginIntentFresh=()=>Date.now()-lastLoginIntentAt<Math.max(gestureWindowMs()*4,
    8e3);
    function markGesture(e){
      if(e&&e.isTrusted){
        lastGestureAt=Date.now(),
        gestureSpent=!1;
        if("keydown"===e.type){
          const __k=e.key;
          if(__k&&"Enter"!==__k&&" "!==__k&&"Spacebar"!==__k)return
        }
        try{
          const el=e.target&&e.target.closest?e.target.closest("a,button,input,[role='button'],[tabindex]"):e.target,
          txt=[el&&(el.textContent||""),
          el&&el.getAttribute&&el.getAttribute("aria-label"),
          el&&el.getAttribute&&el.getAttribute("title"),
          el&&el.getAttribute&&el.getAttribute("value"),
          el&&el.id,
          el&&"string"==typeof el.className?el.className:""].filter(Boolean).join(" ").toLowerCase();
          /\b(continue\s+with\s+google|google|oauth|sso|log\s*in|login|sign\s*in|signin|account|verify|verification|authorize|microsoft|apple|github|facebook|spotify)\b/.test(txt)&&(lastLoginIntentAt=lastGestureAt)
        }
        catch(_){

        }

      }

    }
    function freshGesture(){
      return Date.now()-lastGestureAt<gestureWindowMs()&&!gestureSpent
    }
    function spendGesture(){
      gestureSpent=!0
    }
    ["pointerdown",
    "mousedown",
    "click",
    "auxclick",
    "keydown",
    "touchstart",
    "touchend"].forEach(ev=>window.addEventListener(ev,
    markGesture,
    !0));
    if(WO.blockMetaRefresh){
      const killMeta=()=>{
        document.querySelectorAll('meta[http-equiv="refresh" i]').forEach(m=>{
          const c=m.getAttribute("content")||"",
          match=/url\s*=\s*(.+)$/i.exec(c);
          if(match){
            const dest=match[1].trim().replace(/^['"]|['"]$/g,
            "");
            !WO.__frozen&&(sameSite(location.href,
            dest)||isFederatedAuthTarget(dest)||!isHighRiskNavigationTarget(dest))||(m.setAttribute("data-wo-disabled",
            c),
            m.removeAttribute("content"),
            log("blocked_meta_refresh",
            {
              content:c,
              frozen:!!WO.__frozen
            }))
          }

        })
      };
      killMeta(),
      woObserve(killMeta)
    }
    if(WO.detectRedirectChains){
      const ABUSE_TLDS=/\.(cfd|sbs|icu|top|xyz|click|link|rest|cyou|cam|monster|quest|host|store|online|site|shop|fit|makeup|skin|hair|lol|bond|autos|boats|christmas|beauty)$/i,
      HOSTWORDS=/(storage|generate|download|file|redirect|track|click|landing|offer|cdn|fetch|deliver|secure|verify|gate|link|go)\w*\d/i,
      RANDOMISH_LABEL=/^[a-z]{3,}[0-9a-f]{2,}$|^[a-z]+\d+[a-z]*$/i,
      PAYLOAD_PARAMS=["data",
      "d",
      "p",
      "q",
      "r",
      "payload",
      "s",
      "token"],
      STEP_KEYS=["redirectStep",
      "redirectstep",
      "step",
      "hop",
      "stage",
      "count",
      "n"];
      function countRandomishLabels(host){
        const labels=String(host).toLowerCase().split("."),
        body=labels.slice(0,
        Math.max(1,
        labels.length-1));
        let n=0;
        for(const l of body)RANDOMISH_LABEL.test(l)&&/\d/.test(l)&&n++;
        return n
      }
      function decodeB64Json(s){
        try{
          let t=String(s).replace(/-/g,
          "+").replace(/_/g,
          "/");
          for(;
          t.length%4;
          )t+="=";
          const txt=atob(t);
          return JSON.parse(txt)
        }
        catch{
          return null
        }

      }
      function chainSignal(){
        const u=toURL(location.href);
        if(!u)return null;
        let score=0;
        const reasons=[];
        ABUSE_TLDS.test(u.hostname)&&(score+=2,
        reasons.push("abuse-TLD host")),
        HOSTWORDS.test(u.hostname)&&(score+=2,
        reasons.push("redirect-themed hostname"));
        const randCount=countRandomishLabels(u.hostname);
        randCount>=2?(score+=3,
        reasons.push("multiple random-looking host labels")):1===randCount&&(score+=1,
        reasons.push("random-looking host label"));
        let payload=null;
        for(const p of PAYLOAD_PARAMS){
          const v=u.searchParams.get(p);
          if(v&&v.length>16){
            const obj=decodeB64Json(v);
            if(obj&&"object"==typeof obj){
              payload=obj,
              score+=2,
              reasons.push("base64 JSON payload"),
              STEP_KEYS.some(k=>k in obj)&&(score+=3,
              reasons.push("hop-step counter"));
              break
            }

          }

        }
        return score>=5?{
          score:score,
          reasons:reasons,
          payload:payload,
          host:u.hostname
        }
        :null
      }
      const sig=chainSignal();
      if(sig){
        WO.__frozen=!0,
        document.querySelectorAll('meta[http-equiv="refresh" i]').forEach(m=>{
          m.setAttribute("data-wo-disabled",
          m.getAttribute("content")||""),
          m.removeAttribute("content")
        }),
        log("blocked_redirect_chain",
        {
          host:sig.host,
          reasons:sig.reasons,
          payload:sig.payload
        });
        const next=sig.payload&&(sig.payload.next||sig.payload.url||sig.payload.dest||sig.payload.redirect);
        let teardown=null;
        const paint=()=>{
          const host=buildOverlay("rg-interstitial",
          "rgba(38,20,54,.55)"),
          card=oDiv(host,
          "background:rgba(250,243,253,.92)!important;color:#3d2a52!important;max-width:560px!important;width:100%!important;border:1px solid rgba(176,106,212,.28)!important;border-radius:20px!important;padding:30px!important;backdrop-filter:blur(20px) saturate(1.3)!important;-webkit-backdrop-filter:blur(20px) saturate(1.3)!important;box-shadow:0 24px 70px rgba(80,30,110,.4)!important;font-family:Quicksand,system-ui,sans-serif!important;"),
          titleRow=oDiv(card,
          "display:flex!important;align-items:center!important;gap:11px!important;margin:0 0 8px 0!important;");
          appendShieldSvg(oDiv(titleRow,
          "flex:none!important;width:38px!important;height:38px!important;border-radius:11px!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;display:flex!important;align-items:center!important;justify-content:center!important;box-shadow:0 6px 16px rgba(176,106,212,.4)!important;"),
          "check"),
          oDiv(titleRow,
          "font-size:19px!important;font-weight:700!important;color:#2d1b40!important;font-family:Quicksand,system-ui,sans-serif!important;",
          "Redirect chain blocked"),
          oDiv(card,
          "color:#7a5f93!important;margin:0 0 18px 0!important;font-size:13.5px!important;line-height:1.55!important;font-family:Nunito,system-ui,sans-serif!important;",
          "This page is a relay in a redirect chain  -  the kind used by fake-download and ad-spam sites. It was about to send you onward automatically. WardenOne stopped it.");
          const ROW="background:rgba(176,106,212,.08)!important;border:1px solid rgba(176,106,212,.2)!important;border-radius:10px!important;padding:10px 12px!important;margin:6px 0!important;word-break:break-all!important;font-family:ui-monospace,monospace!important;font-size:12px!important;color:#5a4570!important;",
          LBL="color:#a98fc0!important;font-size:11px!important;font-weight:700!important;text-transform:uppercase!important;letter-spacing:.05em!important;margin:10px 0 3px 0!important;font-family:Nunito,system-ui,sans-serif!important;";
          oDiv(card,
          LBL,
          "You are here"),
          oTextDiv(card,
          ROW,
          String(location.href).slice(0,
          300)),
          next&&(oDiv(card,
          LBL,
          "It was sending you to"),
          oTextDiv(card,
          ROW,
          String(next).slice(0,
          300)));
          const btns=oDiv(card,
          "display:flex!important;gap:10px!important;margin-top:20px!important;flex-wrap:wrap!important;");
          oBtn(btns,
          "background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:11px!important;padding:11px 18px!important;font-size:13.5px!important;font-weight:700!important;font-family:Quicksand,system-ui,sans-serif!important;box-shadow:0 6px 16px rgba(176,106,212,.35)!important;",
          "<- Go back to safety",
          ()=>{
            teardown&&teardown(),
            realGoBack()
          }),
          oBtn(btns,
          "background:rgba(176,106,212,.12)!important;color:#7a5f93!important;border:1px solid rgba(176,106,212,.25)!important;border-radius:11px!important;padding:11px 18px!important;font-size:13.5px!important;font-weight:700!important;font-family:Quicksand,system-ui,sans-serif!important;",
          "Dismiss & stay here",
          ()=>{
            teardown&&teardown()
          }),
          oTextDiv(card,
          "color:#a98fc0!important;font-size:11px!important;margin-top:14px!important;font-family:Nunito,system-ui,sans-serif!important;",
          "Detected: "+sig.reasons.join(", ")),
          document.documentElement.appendChild(host)
        };
        teardown=mountBlocker("rg-interstitial",
        paint)
      }

    }
    if(WO.blockGrabberResources&&Array.isArray(WO.grabberDomains)&&WO.grabberDomains.length){
      let __woGrabSet=null,
      __woGrabSrc=null;
      const isGrabberURL=input=>{
        try{
          if(__woGrabSrc!==WO.grabberDomains){
            __woGrabSrc=WO.grabberDomains;
            __woGrabSet=new Set(WO.grabberDomains)
          }
          const url="string"==typeof input?input:input&&input.url?input.url:String(input),
          h=new URL(url,
          location.href).hostname.replace(/^www\./,
          "").toLowerCase();
          for(let p=h;
          p;
          ){
            if(__woGrabSet.has(p))return p;
            const dot=p.indexOf(".");
            if(dot<0)break;
            p=p.slice(dot+1)
          }
          return null
        }
        catch{
          return null
        }

      };
      if(window.fetch){
        const realFetch=window.fetch;
        window.fetch=function(input,
        init){
          const hit=isGrabberURL(input);
          return hit?(log("blocked_grabber_fetch",
          {
            matched:hit
          }),
          Promise.reject(new TypeError("Blocked by Redirect Guard: known IP-logger ("+hit+")"))):realFetch.apply(this,
          arguments)
        }

      }
      if(window.XMLHttpRequest){
        const realXHROpen=XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open=function(method,
        url){
          const hit=isGrabberURL(url);
          return hit?(log("blocked_grabber_xhr",
          {
            matched:hit
          }),
          this.__woBlocked=!0,
          realXHROpen.call(this,
          method,
          "about:blank")):realXHROpen.apply(this,
          arguments)
        }

      }
      if(navigator.sendBeacon){
        const realBeacon=navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon=function(url,
        data){
          const hit=isGrabberURL(url);
          return hit?(log("blocked_grabber_beacon",
          {
            matched:hit
          }),
          !1):realBeacon(url,
          data)
        }

      }
      try{
        const ImgProto=HTMLImageElement.prototype,
        srcDesc=Object.getOwnPropertyDescriptor(ImgProto,
        "src");
        srcDesc&&srcDesc.set&&Object.defineProperty(ImgProto,
        "src",
        {
          configurable:!0,
          enumerable:!0,
          get(){
            return srcDesc.get.call(this)
          },
          set(v){
            const hit=isGrabberURL(v);
            if(!hit)return srcDesc.set.call(this,
            v);
            log("blocked_grabber_pixel",
            {
              matched:hit
            })
          }

        })
      }
      catch(e){
        log("img_trap_failed",
        {
          error:String(e)
        })
      }
      const sweepNodes=root=>{
        try{
          root.querySelectorAll&&root.querySelectorAll("img[src],script[src],iframe[src]").forEach(el=>{
            const hit=isGrabberURL(el.getAttribute("src"));
            hit&&(el.removeAttribute("src"),
            el.setAttribute("data-wo-blocked",
            hit),
            log("blocked_grabber_element",
            {
              tag:el.tagName,
              matched:hit
            }))
          })
        }
        catch{

        }

      };
      sweepNodes(document),
      woObserve(muts=>{
        for(const m of muts)for(const n of m.addedNodes)if(1===n.nodeType){
          const hit=n.getAttribute&&isGrabberURL(n.getAttribute("src"));
          hit&&(n.removeAttribute("src"),
          n.setAttribute("data-wo-blocked",
          hit),
          log("blocked_grabber_element",
          {
            tag:n.tagName,
            matched:hit
          })),
          sweepNodes(n)
        }

      })
    }
    {
      const REDIRECT_PARAMS=["url",
      "target",
      "redirect",
      "redir",
      "dest",
      "destination",
      "next",
      "continue",
      "u",
      "out",
      "goto",
      "link"],
      SHORTENERS=["bit.ly",
      "tinyurl.com",
      "cutt.ly",
      "is.gd",
      "rebrand.ly",
      "rb.gy",
      "t.co",
      "goo.gl",
      "ow.ly",
      "buff.ly",
      "shorturl.at",
      "tiny.cc",
      "bl.ink",
      "short.io",
      "soo.gd",
      "clck.ru",
      "v.gd",
      "x.co",
      "qr.ae",
      "lnkd.in",
      "trib.al",
      "shor.by"],
      LOGGER_API_PATHS=/\/(log|logs|track|tracker|tracking|visit|capture|collect|hit|beacon|pixel|api\/log|api\/track|api\/collect)(\/|$|\?)/i,
      regDom=regDomain,
      u2=s=>{
        try{
          return new URL(s,
          location.href)
        }
        catch{
          return null
        }

      };
      let lastLinkWarn=0;
      const safeBrowsingAllowedLinks=new WeakSet,
      linkLooksDownloadish=(a,
      url)=>{
        const text=(a&&(a.textContent||a.getAttribute("aria-label")||a.title)||"").toLowerCase(),
        attrs=(a&&(a.id||"")+" "+(a.className||"")+" "+(a.getAttribute("download")||"")||"").toLowerCase();
        return!(!a||!a.hasAttribute("download"))||/\.(exe|scr|msi|bat|cmd|com|pif|jar|vbs|js|ps1|hta|apk|dmg|pkg|deb|rpm|zip|rar|7z)(\?|$)/i.test(url.pathname)||/\b(download|get file|installer|setup|continue download)\b/i.test(text+" "+attrs)
      },
      continueLinkClick=a=>{
        try{
          safeBrowsingAllowedLinks.add(a),
          setTimeout(()=>{
            try{
              safeBrowsingAllowedLinks.delete(a)
            }
            catch(_){

            }

          },
          2500),
          a.click()
        }
        catch(_){
          try{
            location.href=a.href
          }
          catch(_){

          }

        }

      };
      if(window.addEventListener("click",
      e=>{
        const a=e.target&&e.target.closest&&e.target.closest("a[href]");
        if(!a)return;
        if(safeBrowsingAllowedLinks.has(a))return;
        const href=a.getAttribute("href");
        if(!href||"#"===href[0]||/^(javascript|mailto|tel):/i.test(href))return;
        const url=u2(a.href);
        if(!url)return;
        const now=Date.now(),
        canWarn=()=>now-lastLinkWarn>=1500,
        here=regDom(location.hostname),
        dest=regDom(url.hostname),
        sbTargets=[];
        if(WO.warnShorteners&&SHORTENERS.some(s=>dest===s||dest.endsWith("."+s))&&(canWarn()&&(lastLinkWarn=now,
        log("warned_shortener",
        {
          matched:dest
        })),
        sbTargets.push(url.href)),
        WO.warnRedirectParams){
          const linkHost=dest;
          for(const p of REDIRECT_PARAMS){
            const v=url.searchParams.get(p);
            if(v&&/^https?:\/\//i.test(v)){
              const wrapped=u2(v);
              if(!wrapped)continue;
              const wHost=regDom(wrapped.hostname);
              if(wHost!==here&&wHost!==linkHost&&linkHost!==here){
                canWarn()&&(lastLinkWarn=now,
                log("warned_redirect_param",
                {
                  matched:wHost,
                  param:p
                })),
                sbTargets.push(url.href,
                wrapped.href);
                break
              }

            }

          }

        }
        if(linkLooksDownloadish(a,
        url)&&sbTargets.push(url.href),
        urlReputationOn()&&sbTargets.length&&e.isTrusted&&0===e.button&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){
          e.preventDefault(),
          e.stopPropagation();
          const targets=Array.from(new Set(sbTargets));
          Promise.all(targets.map(target=>safeBrowsingCheck(target,
          "link",
          4500))).then(results=>{
            const hit=results.find(r=>r&&r.ok&&r.hit);
            if(hit){
              const matched=hit.url||targets[0];
              return log("blocked_safe_browsing_link",
              {
                matched:matched,
                provider:urlReputationProvider(hit),
                threats:hit.threats||[],
                why:safeBrowsingThreatText(hit)
              }),
              void showSafeBrowsingPanel("Dangerous link blocked",
              hit,
              matched)
            }
            const warning=results.find(r=>r&&r.ok&&r.warning);
            warning&&logReputationWarning(reputationWarningType(warning),
            warning,
            warning.url||targets[0]),
            continueLinkClick(a)
          }).catch(()=>continueLinkClick(a))
        }

      },
      !0),
      WO.monitorLoggerApi){
        const here=regDom(location.hostname),
        isTrustedGoogleNoise=(page,
        dest)=>/(^|\.)(google\.com|google\.co\.uk|googleusercontent\.com)$/i.test(page)&&/(^|\.)(google\.com|google\.co\.uk|googleapis\.com|gstatic\.com|googleusercontent\.com|gvt1\.com|gvt2\.com|ggpht\.com|youtube\.com|ytimg\.com|googlevideo\.com)$/i.test(dest),
        isSuspectApi=input=>{
          const url=u2("string"==typeof input?input:input&&input.url?input.url:String(input));
          if(!url)return null;
          const dest=regDom(url.hostname);
          if(isTrustedGoogleNoise(here,
          dest))return null;
          return dest===here||dest.endsWith("."+here)||here.endsWith("."+dest)?null:LOGGER_API_PATHS.test(url.pathname)?dest:null
        };
        let lastApiWarn=0;
        const warnApi=dest=>{
          const now=Date.now();
          now-lastApiWarn<2e3||(lastApiWarn=now,
          log("warned_logger_api",
          {
            matched:dest
          }))
        };
        if(window.fetch){
          const rf=window.fetch;
          window.fetch=function(input){
            const d=isSuspectApi(input);
            return d&&warnApi(d),
            rf.apply(this,
            arguments)
          }

        }
        if(navigator.sendBeacon){
          const rb=navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon=function(url,
          data){
            const d=isSuspectApi(url);
            return d&&warnApi(d),
            rb(url,
            data)
          }

        }

      }

    }
    if(WO.blockFirstPartyTrackers)try{
      const FP_TRACKER_PATHS=/(^|\/)(g\/collect|j\/collect|r\/collect|gtm\.js|gtag\/js|analytics\.js|ga\.js|__utm\.gif|__gtm|piwik\.php|matomo\.php|pixel\.gif|p\.gif|b\.gif|track\.gif|beacon\?|tr\?id=|insight\/track|i\/adsct)/i,
      looksLikeTracker=input=>{
        try{
          const raw="string"==typeof input?input:input&&input.url?input.url:String(input),
          url=new URL(raw,
          location.href);
          return FP_TRACKER_PATHS.test(url.pathname+url.search)
        }
        catch{
          return!1
        }

      };
      let fpCount=0;
      const noteBlock=()=>{
        ++fpCount<=50&&log("blocked_tracker_request",
        {

        })
      };
      if(window.fetch){
        const rf=window.fetch;
        window.fetch=function(input,
        init){
          return looksLikeTracker(input)?(noteBlock(),
          Promise.resolve(new Response("",
          {
            status:204,
            statusText:"No Content"
          }))):rf.apply(this,
          arguments)
        }

      }
      if(navigator.sendBeacon){
        const rb=navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon=function(url,
        data){
          return looksLikeTracker(url)?(noteBlock(),
          !0):rb(url,
          data)
        }

      }
      if(window.XMLHttpRequest){
        const RX=window.XMLHttpRequest,
        origOpen=RX.prototype.open;
        RX.prototype.open=function(method,
        url,
        ...rest){
          return this.__wo_tracker=looksLikeTracker(url),
          origOpen.call(this,
          method,
          url,
          ...rest)
        };
        const origSend=RX.prototype.send;
        RX.prototype.send=function(...args){
          if(!this.__wo_tracker)return origSend.apply(this,
          args);
          noteBlock();
          try{
            this.abort()
          }
          catch(_){

          }

        }

      }
      log("firstparty_tracker_guard_active",
      {

      })
    }
    catch(e){
      log("firstparty_tracker_failed",
      {
        error:String(e)
      })
    }
    if(WO.trackerLearner)try{
      const TRACKER_HOST_HINTS=/(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|facebook\.com|connect\.facebook\.net|fbcdn\.net|scorecardresearch\.com|criteo\.com|criteo\.net|taboola\.com|outbrain\.com|quantserve\.com|adsrvr\.org|adnxs\.com|rubiconproject\.com|openx\.net|pubmatic\.com|rlcdn\.com|mathtag\.com|bluekai\.com|demdex\.net|everesttech\.net|lijit\.com|sharethrough\.com|yieldmo\.com|segment\.com|segment\.io|amplitude\.com|mixpanel\.com|hotjar\.com|fullstory\.com|clarity\.ms|mouseflow\.com|crazyegg\.com|optimizely\.com)$/i,
      TRACKER_PATH_HINTS=/(^|\/|[?&])(collect|beacon|pixel|analytics|telemetry|conversion|impression|pageview|utag|gtm|gtag)(\/|$|[?&=._-])/i,
      TRACKER_QUERY_HINTS=/(^|&)(utm_|fbp=|fbc=|gclid=|dclid=|msclkid=|adid=|conversion=)/i,
      TRACKER_IGNORE=/(^|\.)(gstatic\.com|googleapis\.com|googleusercontent\.com|cloudflare\.com|cloudflare\.net|akamaihd\.net|fastly\.net|jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|bootstrapcdn\.com|githubusercontent\.com)$/i,
      trackerSeen=new Set,
      noteTracker=(raw,
      kind,
      extraSignal)=>{
        try{
          if(!WO.trackerLearner||trackerSeen.size>80)return;
          const u=u2(raw);
          if(!u||!/^https?:$/i.test(u.protocol))return;
          const here=regDom(location.hostname),
          dest=regDom(u.hostname);
          if(!here||!dest||here===dest||dest.endsWith("."+here)||here.endsWith("."+dest))return;
          if(TRACKER_IGNORE.test(dest)&&!TRACKER_PATH_HINTS.test(u.pathname+u.search)&&!TRACKER_QUERY_HINTS.test(u.search.replace(/^\?/,
          "")))return;
          const hay=u.hostname+u.pathname+u.search;
          let signal="";
          if(TRACKER_HOST_HINTS.test(dest)||TRACKER_HOST_HINTS.test(u.hostname)?signal="known-tracker-host":TRACKER_PATH_HINTS.test(hay)?signal="tracking-path":TRACKER_QUERY_HINTS.test(u.search.replace(/^\?/,
          ""))?signal="tracking-params":extraSignal&&(signal=extraSignal),
          !signal)return;
          const key=dest+"|"+kind+"|"+signal;
          if(trackerSeen.has(key))return;
          trackerSeen.add(key),
          log("detected_thirdparty_tracker",
          {
            domain:dest,
            host:u.hostname,
            kind:kind,
            signal:signal,
            path:u.pathname.slice(0,
            80)
          })
        }
        catch(_){

        }

      };
      if(window.fetch){
        const rf=window.fetch;
        window.fetch=function(input,
        init){
          return noteTracker("string"==typeof input?input:input&&input.url||"",
          "fetch"),
          rf.apply(this,
          arguments)
        }

      }
      if(navigator.sendBeacon){
        const rb=navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon=function(url,
        data){
          return noteTracker(url,
          "beacon",
          "beacon-api"),
          rb(url,
          data)
        }

      }
      if(window.XMLHttpRequest){
        const RX=window.XMLHttpRequest,
        oOpen=RX.prototype.open;
        RX.prototype.open=function(method,
        url){
          try{
            noteTracker(url,
            "xhr")
          }
          catch(_){

          }
          return oOpen.apply(this,
          arguments)
        }

      }
    }
    catch(e){
      log("tracker_learner_failed",
      {
        error:String(e)
      })
    }
    const localAdminTarget=raw=>{
      try{
        const u=u2(raw);
        if(!u||!/^(https?|wss?):$/i.test(u.protocol))return!1;
        const h=u.hostname.replace(/^\[|\]$/g,
        "").toLowerCase(),
        p=u.pathname.toLowerCase();
        if(/^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){0,3}|::1)$/i.test(h))return!0;
        if(/^(f[cd][0-9a-f]{2}|fe80):/i.test(h))return!0;
        if(/^\d{1,3}(\.\d{1,3}){3}$/.test(h)){
          const parts=h.split(".").map(Number),
          a=parts[0],
          b=parts[1];
          return a===10||a===127||a===192&&b===168||a===172&&b>=16&&b<=31||a===169&&b===254
        }
        if(/\.(local|localdomain|lan|home|internal|intranet|corp)$/i.test(h))return!0;
        return/^(router|gateway|modem|fritz\.box|myfiosgateway\.com|tplinkwifi\.net|routerlogin\.net|routerlogin\.com|asusrouter\.com|miwifi\.com)$/i.test(h)||/(^|\/)(admin|login|cgi-bin|goform|setup|webfig|luci)(\/|$)/i.test(p)&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|router|gateway|modem)/i.test(h)
      }
      catch(_){
        return!1
      }

    },
    publicPage=()=>{
      try{
        return/^https?:$/i.test(location.protocol)&&!localAdminTarget(location.href)
      }
      catch(_){
        return!1
      }

    };
    if(WO.intranetProtection&&publicPage())try{
      const blockLocal=(raw,
      how)=>{
        if(!localAdminTarget(raw))return!1;
        log("blocked_intranet_probe",
        {
          matched:String(raw||"").slice(0,
          160),
          how:how||"request",
          why:"public page tried to reach a local/router admin target"
        });
        return!0
      };
      if(window.fetch){
        const rf=window.fetch;
        window.fetch=function(input,
        init){
          const url="string"==typeof input?input:input&&input.url||"";
          return blockLocal(url,
          "fetch")?Promise.reject(new DOMException("Blocked by WardenOne Intranet Guard",
          "SecurityError")):rf.apply(this,
          arguments)
        }

      }
      if(window.XMLHttpRequest){
        const RX=window.XMLHttpRequest,
        oOpen=RX.prototype.open;
        RX.prototype.open=function(method,
        url,
        ...rest){
          this.__wo_local_block=blockLocal(url,
          "xhr");
          return this.__wo_local_block?void 0:oOpen.call(this,
          method,
          url,
          ...rest)
        };
        const oSend=RX.prototype.send;
        RX.prototype.send=function(...args){
          if(this.__wo_local_block){
            try{
              this.abort()
            }
            catch(_){

            }
            return
          }
          return oSend.apply(this,
          args)
        }

      }
      if(window.WebSocket){
        const RealWS=window.WebSocket;
        window.WebSocket=function(url,
        protocols){
          if(blockLocal(url,
          "websocket"))throw new DOMException("Blocked by WardenOne Intranet Guard",
          "SecurityError");
          return void 0===protocols?new RealWS(url):new RealWS(url,
          protocols)
        },
        window.WebSocket.prototype=RealWS.prototype;
        try{
          Object.setPrototypeOf(window.WebSocket,
          RealWS)
        }
        catch(_){

        }

      }
      if(navigator.sendBeacon){
        const rb=navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon=function(url,
        data){
          return blockLocal(url,
          "beacon")?!1:rb(url,
          data)
        }

      }
      const blockForm=form=>{
        try{
          const action=form&&form.action||form&&form.getAttribute&&form.getAttribute("action")||location.href;
          return blockLocal(action,
          "form")
        }
        catch(_){
          return!1
        }

      };
      const localResourceKind=el=>{
        const tag=el&&String(el.tagName||"").toUpperCase();
        if("SCRIPT"===tag)return"script";
        if("IFRAME"===tag||"FRAME"===tag)return"frame";
        if("IMG"===tag||"IMAGE"===tag||"VIDEO"===tag||"AUDIO"===tag||"SOURCE"===tag||"EMBED"===tag||"OBJECT"===tag)return"resource";
        if("LINK"===tag)return"link";
        if("FORM"===tag)return"form";
        return""
      },
      localResourceUrl=el=>{
        try{
          return el&&(el.currentSrc||el.src||el.href||el.action||el.getAttribute("src")||el.getAttribute("href")||el.getAttribute("data")||el.getAttribute("action")||"")
        }
        catch(_){
          return""
        }

      },
      guardLocalNode=el=>{
        const kind=localResourceKind(el);
        if(kind&&blockLocal(localResourceUrl(el),
        kind)){
          try{
            "FORM"===String(el.tagName||"").toUpperCase()?el.removeAttribute("action"):("SCRIPT"===String(el.tagName||"").toUpperCase()&&(el.type="javascript/blocked-by-wardenone"),
            el.removeAttribute("src"),
            el.removeAttribute("href"),
            el.removeAttribute("data"),
            el.remove())
          }
          catch(_){

          }
          return!0
        }
        return!1
      };
      try{
        const ap=Node.prototype.appendChild,
        ib=Node.prototype.insertBefore;
        Node.prototype.appendChild=function(n){
          return n&&1===n.nodeType&&guardLocalNode(n)?n:ap.apply(this,
          arguments)
        },
        Node.prototype.insertBefore=function(n,
        ref){
          return n&&1===n.nodeType&&guardLocalNode(n)?n:ib.apply(this,
          arguments)
        }

      }
      catch(_){

      }
      try{
        const setAttr=Element.prototype.setAttribute;
        Element.prototype.setAttribute=function(name,
        value){
          if(/^(src|href|data|action)$/i.test(String(name||""))&&localResourceKind(this)&&blockLocal(value,
          localResourceKind(this)))return;
          return setAttr.apply(this,
          arguments)
        }

      }
      catch(_){

      }
      document.addEventListener("submit",
      e=>{
        blockForm(e.target)&&(e.preventDefault(),
        e.stopImmediatePropagation())
      },
      !0);
      if(window.HTMLFormElement){
        const oSubmit=HTMLFormElement.prototype.submit;
        oSubmit&&(HTMLFormElement.prototype.submit=function(){
          if(blockForm(this))return;
          return oSubmit.apply(this,
          arguments)
        });
        const oRequest=HTMLFormElement.prototype.requestSubmit;
        oRequest&&(HTMLFormElement.prototype.requestSubmit=function(...args){
          if(blockForm(this))return;
          return oRequest.apply(this,
          args)
        })
      }
      const sweepLocal=root=>{
        try{
          (root||document).querySelectorAll("script[src],iframe[src],frame[src],img[src],image[href],video[src],audio[src],source[src],embed[src],object[data],link[href],form[action]").forEach(guardLocalNode)
        }
        catch(_){

        }

      };
      document.documentElement&&sweepLocal(document),
      woObserve(muts=>{
        for(const mu of muts)for(const n of mu.addedNodes)n&&1===n.nodeType&&(guardLocalNode(n),
        n.querySelectorAll&&sweepLocal(n))
      })
    }
    catch(e){
      log("intranet_guard_failed",
      {
        error:String(e)
      })
    }
    if(publicPage())try{
      const here=regDom(location.hostname),
      full=location.hostname.toLowerCase(),
      label=full.split(".")[0]||"",
      digits=(label.match(/\d/g)||[]).length,
      risky=/^xn--/i.test(full)||/^[a-f0-9]{12,}$/i.test(label)||/[bcdfghjklmnpqrstvwxz]{6,}/i.test(label)||digits>=4&&digits>=.3*label.length||/\.(cfd|sbs|top|xyz|click|link|live|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|skin|bar|fit)$/i.test(full)||((full.match(/-/g)||[]).length>=3||full.length>=40),
      riskyModeOn=()=>!!(WO.enabled&&WO.riskySiteMode&&risky),
      RISKY_PLAYER_KINDS=/^(script|frame|media|fetch|xhr|websocket)$/,
      riskyPlayerPage=()=>playerPageDetected(),
      TRUSTED_THIRD_PARTY=/(^|\.)(cloudflare\.com|cloudflare\.net|akamaihd\.net|fastly\.net|jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|bootstrapcdn\.com|gstatic\.com|googleapis\.com|githubusercontent\.com)$/i,
      riskyKind=el=>{
        const tag=el&&String(el.tagName||"").toUpperCase();
        if("SCRIPT"===tag)return"script";
        if("IFRAME"===tag||"FRAME"===tag)return"frame";
        if("VIDEO"===tag||"AUDIO"===tag||"SOURCE"===tag||"EMBED"===tag||"OBJECT"===tag)return"media";
        return""
      },
      foreignRiskUrl=raw=>{
        try{
          const u=u2(raw);
          if(!u||!/^https?:$/i.test(u.protocol))return!1;
          const dest=regDom(u.hostname);
          return!!(dest&&here&&dest!==here&&!dest.endsWith("."+here)&&!here.endsWith("."+dest)&&!TRUSTED_THIRD_PARTY.test(dest))
        }
        catch(_){
          return!1
        }

      },
      blockRisk=(raw,
      kind)=>{
        if(!riskyModeOn()||!foreignRiskUrl(raw))return!1;
        if(RISKY_PLAYER_KINDS.test(String(kind||""))&&riskyPlayerPage())return!1;
        log("blocked_risky_site_resource",
        {
          matched:String(raw||"").slice(0,
          160),
          kind:kind||"resource",
          why:"risky-site mode blocks third-party active content on suspicious domains"
        });
        return!0
      },
      srcOf=el=>{
        try{
          return el&&(el.currentSrc||el.src||el.getAttribute("src")||el.getAttribute("data")||el.getAttribute("data-src")||el.getAttribute("href")||"")
        }
        catch(_){
          return""
        }

      },
      guardNode=el=>{
        const kind=riskyKind(el);
        if(kind&&blockRisk(srcOf(el),
        kind)){
          try{
            "SCRIPT"===String(el.tagName||"").toUpperCase()?el.type="javascript/blocked-by-wardenone":el.removeAttribute("src"),
            el.remove()
          }
          catch(_){

          }
          return!0
        }
        return!1
      };
      if(risky){
        try{
          const ap=Node.prototype.appendChild,
          ib=Node.prototype.insertBefore;
          Node.prototype.appendChild=function(n){
            return n&&1===n.nodeType&&guardNode(n)?n:ap.apply(this,
            arguments)
          },
          Node.prototype.insertBefore=function(n,
          ref){
            return n&&1===n.nodeType&&guardNode(n)?n:ib.apply(this,
            arguments)
          }

        }
        catch(_){

        }
        try{
          const setAttr=Element.prototype.setAttribute;
          Element.prototype.setAttribute=function(name,
          value){
            if(/^(src|href|data)$/i.test(String(name||""))&&riskyKind(this)&&blockRisk(value,
            riskyKind(this)))return;
            return setAttr.apply(this,
            arguments)
          }

        }
        catch(_){

        }
        if(window.fetch){
          const rf=window.fetch;
          window.fetch=function(input,
          init){
            const url="string"==typeof input?input:input&&input.url||"";
            return blockRisk(url,
            "fetch")?Promise.reject(new DOMException("Blocked by WardenOne Risky-site Mode",
            "SecurityError")):rf.apply(this,
            arguments)
          }

        }
        if(window.XMLHttpRequest){
          const RX=window.XMLHttpRequest,
          oOpen=RX.prototype.open;
          RX.prototype.open=function(method,
          url,
          ...rest){
            this.__wo_risky_block=blockRisk(url,
            "xhr");
            return this.__wo_risky_block?void 0:oOpen.call(this,
            method,
            url,
            ...rest)
          };
          const oSend=RX.prototype.send;
          RX.prototype.send=function(...args){
            if(this.__wo_risky_block){
              try{
                this.abort()
              }
              catch(_){

              }
              return
            }
            return oSend.apply(this,
            args)
          }

        }
        if(window.WebSocket){
          const RealWS=window.WebSocket;
          window.WebSocket=function(url,
          protocols){
            if(blockRisk(url,
            "websocket"))throw new DOMException("Blocked by WardenOne Risky-site Mode",
            "SecurityError");
            return void 0===protocols?new RealWS(url):new RealWS(url,
            protocols)
          },
          window.WebSocket.prototype=RealWS.prototype;
          try{
            Object.setPrototypeOf(window.WebSocket,
            RealWS)
          }
          catch(_){

          }

        }
        if(navigator.sendBeacon){
          const rb=navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon=function(url,
          data){
            return blockRisk(url,
            "beacon")?!1:rb(url,
            data)
          }

        }
        const sweep=root=>{
          try{
            (root||document).querySelectorAll("script[src],iframe[src],frame[src],video[src],audio[src],source[src],embed[src],object[data]").forEach(guardNode)
          }
          catch(_){

          }

        };
        document.documentElement&&sweep(document),
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)n&&1===n.nodeType&&(guardNode(n),
          n.querySelectorAll&&sweep(n))
        }),
        riskyModeOn()&&log("risky_site_mode_active",
        {
          host:here
        })
      }

    }
    catch(e){
      log("risky_site_mode_failed",
      {
        error:String(e)
      })
    }
    if(WO.antiClickjacking)try{
      const warnedClick=new WeakSet,
      SENSITIVE_CLICK=/\b(log\s?in|sign\s?in|password|checkout|pay|buy|transfer|authorize|allow|approve|connect|wallet|seed|download|install|submit|continue|verify)\b/i,
      clickText=el=>{
        try{
          return((el.innerText||el.textContent||"")+" "+(el.value||"")+" "+(el.getAttribute&&el.getAttribute("aria-label")||"")+" "+(el.id||"")+" "+(el.className||"")).replace(/\s+/g,
          " ").slice(0,
          220)
        }
        catch(_){
          return""
        }

      },
      clickTarget=el=>{
        try{
          return el&&el.closest&&el.closest('button,a,input[type="submit"],input[type="button"],[role="button"],label,[onclick]')
        }
        catch(_){
          return null
        }

      },
      frameSuspicious=()=>{
        try{
          if(window.top===window)return!1;
          const ref=document.referrer?new URL(document.referrer):null,
          refHost=ref?regDom(ref.hostname):"",
          here=regDom(location.hostname);
          return!refHost||!here||refHost!==here&&!refHost.endsWith("."+here)&&!here.endsWith("."+refHost)
        }
        catch(_){
          return window.top!==window
        }

      },
      looksCovered=(ev,
      target)=>{
        try{
          const topEl=document.elementFromPoint(ev.clientX,
          ev.clientY);
          if(!topEl||!target||topEl===target||target.contains(topEl)||topEl.contains(target))return!1;
          if(!/^(iframe|frame)$/i.test(topEl.tagName||""))return!1;
          try{
            return!topEl.contentDocument
          }
          catch(_){
            return!0
          }
        }
        catch(_){
          return!1
        }

      };
      document.addEventListener("click",
      e=>{
        const target=clickTarget(e.target);
        if(!target||warnedClick.has(target))return;
        const label=clickText(target);
        if(!SENSITIVE_CLICK.test(label))return;
        if(!looksCovered(e,
        target))return;
        e.preventDefault(),
        e.stopImmediatePropagation(),
        warnedClick.add(target),
        log("warned_clickjacking",
        {
          matched:label.slice(0,
          80),
          framed:window.top!==window,
          why:"sensitive click happened in an embedded or covered context"
        });
        const ok=confirm("WardenOne clickjacking check: this sensitive button is inside a frame or covered context. Continue?");
        ok&&setTimeout(()=>target.click(),
        20)
      },
      !0)
    }
    catch(e){
      log("clickjacking_guard_failed",
      {
        error:String(e)
      })
    }
    let cookieBlockerInstalled=!1,
    cookieBlockerOriginalOwnDesc=null,
    cookieBlockLogCount=0;
    const restoreCookieBlocker=()=>{
      if(cookieBlockerInstalled){
        try{
          cookieBlockerOriginalOwnDesc?Object.defineProperty(document,
          "cookie",
          cookieBlockerOriginalOwnDesc):delete document.cookie
        }
        catch(_){

        }
        cookieBlockerInstalled=!1,
        cookieBlockerOriginalOwnDesc=null;
        try{
          document.__woCookieBlockerActive=!1,
          document.__woCookieBlockerReason=""
        }
        catch(_){

        }

      }

    },
    applyCookieBlocker=()=>{
      const knownTrackerFrame=/(^|\.)(scorecardresearch\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com|quantserve\.com|adsrvr\.org|adnxs\.com|rubiconproject\.com|openx\.net|pubmatic\.com|bluekai\.com|demdex\.net|everesttech\.net|hotjar\.com|fullstory\.com|mouseflow\.com)$/i.test(location.hostname),
      reason=WO.blockThirdPartyCookies&&knownTrackerFrame&&(()=>{
        try{
          if(window.top===window.self)return!1;
          try{
            return siteKey(window.top.location.hostname)!==siteKey(location.hostname)
          }
          catch(_){
            return!0
          }

        }
        catch(_){
          return!0
        }

      })()?"thirdparty":"";
      if(reason){
        if(!cookieBlockerInstalled||document.__woCookieBlockerReason!==reason){
          restoreCookieBlocker();
          try{
            cookieBlockerOriginalOwnDesc=Object.prototype.hasOwnProperty.call(document,
            "cookie")?Object.getOwnPropertyDescriptor(document,
            "cookie"):null,
            Object.defineProperty(document,
            "cookie",
            {
              configurable:!0,
              get:()=>"",
              set:()=>(++cookieBlockLogCount<=50&&log("blocked_thirdparty_cookie",
              {
                scope:reason
              }),
              !0)
            }),
            cookieBlockerInstalled=!0;
            try{
              document.__woCookieBlockerActive=!0,
              document.__woCookieBlockerReason=reason
            }
            catch(_){

            }
            log("thirdparty_cookie_guard_active",
            {

            })
          }
          catch(e){
            log("thirdparty_cookie_failed",
            {
              error:String(e)
            })
          }

        }

      }
      else restoreCookieBlocker()
    };
    applyCookieBlocker();
    try{
      document.addEventListener("wo-config-change",
      applyCookieBlocker)
    }
    catch(_){

    }
    let supercookieGuardInstalled=!1;
    const installSupercookieGuard=()=>{
      if(supercookieGuardInstalled||!WO.blockSupercookies)return;
      const TRACKER_STORAGE_HOSTS=/(^|\.)(scorecardresearch\.com|criteo\.com|criteo\.net|taboola\.com|outbrain\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com|quantserve\.com|adsrvr\.org|adnxs\.com|rubiconproject\.com|openx\.net|pubmatic\.com|rlcdn\.com|mathtag\.com|bluekai\.com|demdex\.net|everesttech\.net|lijit\.com|sharethrough\.com|yieldmo\.com|facebook\.com|fbcdn\.net)$/i;
      if(!(()=>{
        if(!TRACKER_STORAGE_HOSTS.test(location.hostname))return!1;
        try{
          return window.top!==window.self&&regDomain(window.top.location.hostname)!==regDomain(location.hostname)
        }
        catch(_){
          return window.top!==window.self
        }

      })())return;
      supercookieGuardInstalled=!0;
      const clearTrackerStorage=()=>{
        try{
          localStorage.clear()
        }
        catch(_){

        }
        try{
          sessionStorage.clear()
        }
        catch(_){

        }
        try{
          window.name=""
        }
        catch(_){

        }
        try{
          (document.cookie||"").split(";").forEach(c=>{
            const name=c.split("=")[0].trim();
            name&&(document.cookie=name+"=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/",
            document.cookie=name+"=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=."+regDomain(location.hostname))
          })
        }
        catch(_){

        }
        try{
          indexedDB&&indexedDB.databases&&indexedDB.databases().then(dbs=>(dbs||[]).forEach(db=>{
            try{
              db&&db.name&&indexedDB.deleteDatabase(db.name)
            }
            catch(_){

            }

          })).catch(()=>{

          })
        }
        catch(_){

        }
        try{
          window.caches&&caches.keys&&caches.keys().then(keys=>(keys||[]).forEach(k=>{
            try{
              caches.delete(k)
            }
            catch(_){

            }

          })).catch(()=>{

          })
        }
        catch(_){

        }

      };
      clearTrackerStorage();
      try{
        const oSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(){
          try{
            clearTrackerStorage()
          }
          catch(_){

          }

        },
        Storage.prototype.removeItem=function(){

        },
        Storage.prototype.clear=function(){

        },
        Storage.prototype.__woSupercookieOriginalSetItem=oSet
      }
      catch(_){

      }
      log("cleared_tracker_supercookie",
      {
        host:location.hostname
      })
    };
    installSupercookieGuard();
    try{
      document.addEventListener("wo-config-change",
      installSupercookieGuard)
    }
    catch(_){

    }
    if(WO.sessionShield)try{
      const mask=v=>(v=String(v||"")).length<=12?"****":v.slice(0,
      6)+"...hidden..."+v.slice(-4),
      looksLikeJWT=v=>/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(v||"")),
      TOKEN_KEY=/(token|auth|session|sess|jwt|bearer|access[_-]?token|id[_-]?token|refresh[_-]?token|api[_-]?key|secret|credential)/i,
      TOKEN_VAL=/^(ey[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})$/,
      findings=[],
      seenPreviews=new Set,
      addFinding=(where,
      key,
      value)=>{
        const v=String(value||"");
        if(v.length<16)return;
        if(!(TOKEN_KEY.test(key)||TOKEN_VAL.test(v)||looksLikeJWT(v)))return;
        const previewKey=where+"|"+key+"|"+v.slice(0,
        8);
        if(seenPreviews.has(previewKey))return;
        seenPreviews.add(previewKey);
        const f={
          where:where,
          key:String(key).slice(0,
          60),
          preview:mask(v)
        };
        if(looksLikeJWT(v))try{
          const payload=JSON.parse(atob(v.split(".")[1].replace(/-/g,
          "+").replace(/_/g,
          "/"))),
          now=Math.floor(Date.now()/1e3);
          f.jwt={
            exp:payload.exp||null,
            iss:payload.iss?String(payload.iss).slice(0,
            40):null,
            aud:payload.aud?String(payload.aud).slice(0,
            40):null,
            expired:payload.exp?payload.exp<now:null,
            longLived:payload.exp?payload.exp-(payload.iat||now)>604800:null
          }

        }
        catch(_){
          f.jwt={
            malformed:!0
          }

        }
        findings.push(f)
      },
      scanStorage=(store,
      label)=>{
        try{
          for(let i=0;
          i<store.length;
          i++){
            const k=store.key(i);
            addFinding(label,
            k,
            store.getItem(k))
          }

        }
        catch(_){

        }

      };
      scanStorage(window.localStorage,
      "localStorage"),
      scanStorage(window.sessionStorage,
      "sessionStorage");
      try{
        (document.cookie||"").split(";").forEach(c=>{
          const eq=c.indexOf("=");
          eq>0&&addFinding("cookie (readable)",
          c.slice(0,
          eq).trim(),
          c.slice(eq+1).trim())
        })
      }
      catch(_){

      }
      try{
        const checkParams=(str,
        label)=>{
          const sp=new URLSearchParams(str);
          for(const[k,
          v]of sp)addFinding(label,
          k,
          v)
        };
        checkParams(location.search.replace(/^\?/,
        ""),
        "URL query string"),
        checkParams(location.hash.replace(/^#/,
        ""),
        "URL hash")
      }
      catch(_){

      }
      try{
        window.name&&window.name.length>=16&&addFinding("window.name",
        "window.name",
        window.name)
      }
      catch(_){

      }
      let readableCookieCount=0;
      try{
        readableCookieCount=document.cookie?document.cookie.split(";").filter(s=>s.trim()).length:0
      }
      catch(_){

      }
      const onHttps="https:"===location.protocol,
      pageText=(document.title+" "+location.pathname).toLowerCase(),
      isSensitivePage=/(login|log-in|signin|sign-in|account|checkout|payment|password|auth)/.test(pageText),
      thirdPartyScripts=[];
      if(isSensitivePage)try{
        const here=regDomain(location.hostname);
        document.querySelectorAll("script[src]").forEach(s=>{
          try{
            const h=regDomain(new URL(s.src,
            location.href).hostname);
            !h||h===here||h.endsWith("."+here)||here.endsWith("."+h)||thirdPartyScripts.includes(h)||thirdPartyScripts.push(h)
          }
          catch(_){

          }

        })
      }
      catch(_){

      }
      window.__WO_SESSION__={
        host:location.hostname,
        findings:findings.slice(0,
        25),
        tokenCount:findings.length,
        readableCookieCount:readableCookieCount,
        onHttps:onHttps,
        isSensitivePage:isSensitivePage,
        thirdPartyScripts:thirdPartyScripts.slice(0,
        15),
        at:Date.now()
      };
      const SESSION_TRUSTED=/(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com|youtube\.com|youtubei\.googleapis\.com|netflix\.com|nflxso\.net|twitch\.tv|x\.com|twitter\.com|discord\.com|discordapp\.com|slack\.com|figma\.com|notion\.so|dropbox\.com|drive\.google\.com|accounts\.google\.com|login\.microsoftonline\.com|outlook\.office\.com|icloud\.com)$/i.test(location.hostname);
      if(findings.length&&!SESSION_TRUSTED){
        const wheres=Array.from(new Set(findings.map(f=>f.where)));
        log("session_token_exposed",
        {
          count:findings.length,
          where:wheres.join(", ")
        })
      }
      isSensitivePage&&thirdPartyScripts.length&&log("login_thirdparty_scripts",
      {
        count:thirdPartyScripts.length
      })
    }
    catch(e){
      log("sessionshield_failed",
      {
        error:String(e)
      })
    }
    if(WO.blockTokenExfil||WO.continuousTokenScan||WO.detectSkimmers||WO.paymentCardGuard)try{
      const here=regDomain(location.hostname),
      TOKEN_EXFIL_TRUST_POLICY=(()=>{
        const normalizeHost=host=>String(host||"").trim().replace(/^\.+|\.+$/g,
        "").toLowerCase(),
        hostMatches=(host,
        domain)=>host===domain||host.endsWith("."+domain),
        hostMatchesAny=(host,
        domains)=>domains.some(domain=>hostMatches(host,
        domain)),
        globalDestinations=["google.com",
        "gstatic.com",
        "googleapis.com",
        "youtube.com",
        "youtube-nocookie.com",
        "youtu.be",
        "googlevideo.com",
        "ytimg.com",
        "ggpht.com",
        "twitch.tv",
        "ttvnw.net",
        "jtvnw.net",
        "twitchcdn.net",
        "facebook.com",
        "fbcdn.net",
        "apple.com",
        "icloud.com",
        "microsoft.com",
        "microsoftonline.com",
        "live.com",
        "office.com",
        "okta.com",
        "auth0.com",
        "onelogin.com",
        "duosecurity.com",
        "paypal.com",
        "paypalobjects.com",
        "stripe.com",
        "stripe.network",
        "braintreegateway.com",
        "braintreepayments.com",
        "adyen.com",
        "adyenpayments.com",
        "checkout.com",
        "cloudflare.com",
        "cloudflare.net",
        "hcaptcha.com",
        "recaptcha.net",
        "arkoselabs.com",
        "funcaptcha.com",
        "gravatar.com"],
        families=[{
          pages:["spotify.com",
          "scdn.co",
          "spotifycdn.com"],
          destinations:["spotify.com",
          "scdn.co",
          "spotifycdn.com",
          "spotify.map.fastly.net"]
        },
        {
          pages:["youtube.com",
          "youtubei.googleapis.com"],
          destinations:["youtube.com",
          "youtube-nocookie.com",
          "youtu.be",
          "googlevideo.com",
          "ytimg.com",
          "youtubei.googleapis.com",
          "ggpht.com",
          "google.com",
          "googleapis.com",
          "gstatic.com",
          "googleusercontent.com"]
        },
        {
          pages:["netflix.com",
          "nflxso.net"],
          destinations:["netflix.com",
          "nflxso.net",
          "nflxvideo.net",
          "nflximg.net"]
        },
        {
          pages:["twitch.tv"],
          destinations:["twitch.tv",
          "ttvnw.net",
          "jtvnw.net",
          "twitchcdn.net"]
        },
        {
          pages:["x.com",
          "twitter.com"],
          destinations:["x.com",
          "twitter.com",
          "twimg.com",
          "t.co"]
        },
        {
          pages:["discord.com",
          "discordapp.com"],
          destinations:["discord.com",
          "discordapp.com",
          "discordapp.net",
          "discord.gg"]
        },
        {
          pages:["github.com",
          "github.dev"],
          destinations:["github.com",
          "githubusercontent.com",
          "githubassets.com",
          "github.io",
          "githubapp.com",
          "githubcopilot.com",
          "github.dev"]
        },
        {
          pages:["gptzero.me"],
          destinations:["gptzero.me",
          "supabase.co"]
        },
        {
          pages:["slack.com"],
          destinations:["slack.com",
          "slack-edge.com",
          "slack-files.com",
          "slack-imgs.com",
          "slackb.com"]
        },
        {
          pages:["figma.com"],
          destinations:["figma.com",
          "figmausercontent.com"]
        },
        {
          pages:["notion.so"],
          destinations:["notion.so",
          "notion.site",
          "notion-static.com"]
        },
        {
          pages:["dropbox.com"],
          destinations:["dropbox.com",
          "dropboxapi.com",
          "dropboxusercontent.com",
          "dropboxstatic.com"]
        },
        {
          pages:["drive.google.com",
          "accounts.google.com"],
          destinations:["google.com",
          "googleapis.com",
          "gstatic.com",
          "googleusercontent.com"]
        },
        {
          pages:["login.microsoftonline.com",
          "outlook.office.com"],
          destinations:["microsoft.com",
          "microsoft365.com",
          "microsoftonline.com",
          "live.com",
          "outlook.com",
          "office.com",
          "office365.com",
          "sharepoint.com",
          "onmicrosoft.com",
          "msftauth.net",
          "msauth.net",
          "azure.com",
          "azureedge.net",
          "aka.ms"]
        },
        {
          pages:["icloud.com"],
          destinations:["apple.com",
          "icloud.com",
          "me.com",
          "apple-cloudkit.com",
          "cdn-apple.com"]
        }],
        /* Apps built on a managed backend send their own session token to their own
        database host, which sits on a different registrable domain. Blocking that
        breaks the app outright. Trusting these platforms globally is not acceptable
        either: anyone can register a project on them in minutes, so a blanket rule
        would let any page ship tokens to a backend an attacker controls. Trust the
        destination only when the page itself declares that exact host, which is how
        a real app configures its own backend. */
        managedBackends=["supabase.co",
        "supabase.in",
        "firebaseio.com",
        "firebaseapp.com",
        "cloudfunctions.net",
        "appwrite.io"],
        declaredHostCache=new Map(),
        pageDeclaresHost=host=>{
          const want=normalizeHost(host);
          if(!want)return!1;
          if(declaredHostCache.has(want))return declaredHostCache.get(want);
          let found=!1;
          try{
            const nodes=document.querySelectorAll("script[src],link[href]");
            for(let i=0;i<nodes.length&&!found;i++){
              const raw=nodes[i].getAttribute("src")||nodes[i].getAttribute("href")||"";
              if(!raw)continue;
              try{
                if(normalizeHost(new URL(raw,
                location.href).hostname)===want)found=!0
              }
              catch(_){}
            }
          }
          catch(_){}
          declaredHostCache.set(want,
          found);
          return found
        };
        return(pageHost,
        targetHost)=>{
          const page=normalizeHost(pageHost),
          target=normalizeHost(targetHost);
          if(!page||!target)return!1;
          if(hostMatchesAny(target,
          globalDestinations))return!0;
          if(hostMatchesAny(target,
          managedBackends)&&pageDeclaresHost(targetHost))return!0;
          const family=families.find(candidate=>hostMatchesAny(page,
          candidate.pages));
          return!!family&&hostMatchesAny(target,
          family.destinations)
        }
      })(),
      suppressExpectedTokenLog=/(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com|youtube\.com|youtubei\.googleapis\.com|netflix\.com|nflxso\.net|twitch\.tv|x\.com|twitter\.com|discord\.com|discordapp\.com|slack\.com|figma\.com|notion\.so|dropbox\.com|drive\.google\.com|accounts\.google\.com|login\.microsoftonline\.com|outlook\.office\.com|icloud\.com)$/i.test(location.hostname),
      looksLikeJWT2=v=>/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(v||"")),
      normalizeTokenKey=key=>String(key||"").trim().replace(/^["']|["']$/g,
      "").replace(/([a-z0-9])([A-Z])/g,
      "$1_$2").replace(/[^A-Za-z0-9]+/g,
      "_").replace(/^_+|_+$/g,
      "").toLowerCase(),
      SENSITIVE_KEY_COMPONENT=/(^|_)(?:token|auth|authorization|session|sess|jwt|bearer|secret|credential|password|passwd)(?:_|$)|(^|_)(?:api|private|csrf|xsrf|access|refresh|identity|client)_(?:key|token|secret|id)(?:_|$)/,
      SENSITIVE_HEADER_KEY=/^(?:authorization|proxy_authorization|cookie|x_api_key|x_auth_token|x_csrf_token)$/,
      keyIsChallengeResponse=key=>{
        const parts=normalizeTokenKey(key).split("_").filter(Boolean),
        challenge=parts.some(part=>/^(?:captcha|challenge|verification|human)$/.test(part)||/^[a-z0-9]{1,3}captcha$/.test(part)),
        forbidden=parts.some(part=>/^(?:auth|authorization|session|sess|jwt|bearer|secret|credential|password|passwd|api|private|csrf|xsrf|access|refresh|identity|client)$/.test(part));
        return challenge&&!forbidden
      },
      TOK=/^(ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Fa-f0-9]{32,}|[A-Za-z0-9_\-]{40,})$/,
      TOK_ANY=/\b(ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Fa-f0-9]{32,}|[A-Za-z0-9_\-]{40,})\b/,
      JWT_ANY=/(?:^|[^A-Za-z0-9_-])ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:$|[^A-Za-z0-9_-])/,
      keyIsSensitive=key=>{
        const normalized=normalizeTokenKey(key);
        return!!normalized&&!keyIsChallengeResponse(normalized)&&(SENSITIVE_HEADER_KEY.test(normalized)||SENSITIVE_KEY_COMPONENT.test(normalized))
      },
      valueLooksSecret=value=>{
        const normalized=String(value||"").trim().replace(/^Bearer\s+/i,
        "").replace(/^["']|["']$/g,
        "");
        return normalized.length>=16&&(TOK.test(normalized)||looksLikeJWT2(normalized)||TOK_ANY.test(normalized))
      },
      tokenPrefixes=new Set,
      noteToken=v=>{
        (v=String(v||"")).length>=20&&(TOK.test(v)||looksLikeJWT2(v))&&tokenPrefixes.add(v.slice(0,
        16))
      };
      try{
        for(let i=0;
        i<localStorage.length;
        i++)noteToken(localStorage.getItem(localStorage.key(i)));
        for(let i=0;
        i<sessionStorage.length;
        i++)noteToken(sessionStorage.getItem(sessionStorage.key(i)));
        (document.cookie||"").split(";").forEach(c=>{
          const eq=c.indexOf("=");
          eq>0&&noteToken(c.slice(eq+1).trim())
        })
      }
      catch(_){

      }
      const dataToString=data=>{
        try{
          if(null==data)return"";
          if("string"==typeof data)return data;
          if("undefined"!=typeof URLSearchParams&&data instanceof URLSearchParams)return data.toString();
          if("undefined"!=typeof FormData&&data instanceof FormData){
            const parts=[];
            return data.forEach((v,
            k)=>parts.push(String(k)+"="+String(v))),
            parts.join("&")
          }
          if("undefined"!=typeof Headers&&data instanceof Headers){
            const parts=[];
            return data.forEach((v,
            k)=>parts.push(String(k)+": "+String(v))),
            parts.join("\n")
          }
          if(Array.isArray(data))return data.map(p=>Array.isArray(p)?p.join("="):String(p)).join("&");
          if("undefined"!=typeof ArrayBuffer&&(data instanceof ArrayBuffer||ArrayBuffer.isView(data)))try{
            return(data.byteLength||0)>524288?"":new TextDecoder("utf-8").decode(data)
          }
          catch(_){
            return""
          }
          if("undefined"!=typeof Blob&&data instanceof Blob)return"";
          if("object"==typeof data)try{
            return JSON.stringify(data)
          }
          catch(_){

          }
          return data&&data.toString?data.toString():""
        }
        catch(_){
          return""
        }

      },
      headersToString=(...headersList)=>{
        const out=[];
        for(const headers of headersList)if(headers)try{
          "string"==typeof headers?out.push(headers):"undefined"!=typeof Headers&&headers instanceof Headers?headers.forEach((v,
          k)=>out.push(String(k)+": "+String(v))):Array.isArray(headers)?headers.forEach(p=>{
            Array.isArray(p)&&out.push(String(p[0])+": "+String(p[1]))
          }):"object"==typeof headers&&Object.keys(headers).forEach(k=>out.push(String(k)+": "+String(headers[k])))
        }
        catch(_){

        }
        return out.join("\n")
      },
      b64Cores=v=>{
        const out=[];
        try{
          const s=String(v||"");
          if(s.length<12)return out;
          for(let k=0;
          k<3;
          k++){
            const core=btoa("xx".slice(0,
            k)+s).slice(4,
            -4);
            core.length>=10&&out.push(core)
          }

        }
        catch(_){

        }
        return out
      },
      hayHasEncoded=(hay,
      v)=>{
        const s=String(hay||"");
        if(!s)return!1;
        for(const core of b64Cores(v))if(-1!==s.indexOf(core))return!0;
        return!1
      },
      stringHasToken=text=>{
        try{
          const s=String(text||"");
          if(!s||s.length<16)return!1;
          if(JWT_ANY.test(s)||hasKnownTokenPrefix(s))return!0;
          for(const line of s.split(/\r?\n/)){
            const colon=line.indexOf(":");
            if(colon>0&&SENSITIVE_HEADER_KEY.test(normalizeTokenKey(line.slice(0,
            colon)))&&valueLooksSecret(line.slice(colon+1)))return!0
          }
          try{
            const params=new URLSearchParams(s.replace(/^[?#]/,
            ""));
            for(const[k,
            v]of params)if(keyIsSensitive(k)&&valueLooksSecret(v))return!0
          }
          catch(_){

          }
          try{
            const parsed=JSON.parse(s);
            let visited=0;
            const walk=(value,
            key,
            depth)=>{
              if(++visited>96||depth>5)return!1;
              if(null==value)return!1;
              if("object"!=typeof value)return keyIsSensitive(key)&&valueLooksSecret(value);
              if(Array.isArray(value))return value.some(item=>walk(item,
              key,
              depth+1));
              return Object.keys(value).slice(0,
              64).some(child=>walk(value[child],
              child,
              depth+1))
            };
            if(walk(parsed,
            "",
            0))return!0
          }
          catch(_){

          }
          const pairRe=/(?:^|[?&\n{,;])\s*["']?([A-Za-z0-9_-]{1,64})["']?\s*(?:=|:)\s*["']?(?:Bearer\s+)?([A-Za-z0-9_.-]{16,})/gi;
          let match;
          for(;null!==(match=pairRe.exec(s));)if(keyIsSensitive(match[1])&&valueLooksSecret(match[2]))return!0;
          return!1
        }
        catch{
          return!1
        }

      },
      hasKnownTokenPrefix=text=>{
        const s=String(text||"");
        for(const pre of tokenPrefixes)if(pre.length>=12&&-1!==s.indexOf(pre))return!0;
        return!1
      },
      urlHasToken=url=>{
        try{
          const u=new URL(url,
          location.href);
          return stringHasToken(u.href)
        }
        catch{
          return!1
        }

      },
      bodyHasToken=(data,
      url,
      headers)=>stringHasToken(dataToString(data))||stringHasToken(headersToString(headers))||url&&urlHasToken(url),
      destIsForeign=url=>{
        try{
          const target=new URL(url,
          location.href),
          h=regDomain(target.hostname);
          return!(!h||h===here||h.endsWith("."+here)||here.endsWith("."+h))&&!TOKEN_EXFIL_TRUST_POLICY(location.hostname,
          target.hostname)&&h
        }
        catch{
          return!1
        }

      };
      if(WO.blockTokenExfil){
        let exfilCount=0;
        const flagExfil=dest=>{
          ++exfilCount<=50&&log("blocked_token_exfil",
          {
            dest:String(dest).slice(0,
            60)
          })
        };
        if(window.fetch){
          const rf=window.fetch;
          window.fetch=function(input,
          init){
            try{
              const url="string"==typeof input?input:input&&input.url,
              dest=destIsForeign(url);
              if(dest){
                const body=init&&init.body||input&&input.body,
                headers=headersToString(input&&input.headers,
                init&&init.headers);
                if(bodyHasToken(body,
                url,
                headers))return flagExfil(dest),
                Promise.reject(new DOMException("Blocked by WardenOne SessionShield",
                "SecurityError"))
              }

            }
            catch(_){

            }
            return rf.apply(this,
            arguments)
          }

        }
        if(navigator.sendBeacon){
          const rb=navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon=function(url,
          data){
            const dest=destIsForeign(url);
            return dest&&bodyHasToken(data,
            url)?(flagExfil(dest),
            !1):rb(url,
            data)
          }

        }
        if(window.XMLHttpRequest){
          const RX=window.XMLHttpRequest,
          oOpen=RX.prototype.open;
          RX.prototype.open=function(m,
          url,
          ...rest){
            return this.__wo_dest=destIsForeign(url),
            this.__wo_url=url,
            this.__wo_headers=[],
            oOpen.call(this,
            m,
            url,
            ...rest)
          };
          const oSetHeader=RX.prototype.setRequestHeader;
          oSetHeader&&(RX.prototype.setRequestHeader=function(name,
          value){
            try{
              this.__wo_headers&&this.__wo_headers.push(String(name)+": "+String(value))
            }
            catch(_){

            }
            return oSetHeader.call(this,
            name,
            value)
          });
          const oSend=RX.prototype.send;
          RX.prototype.send=function(body){
            if(!this.__wo_dest||!bodyHasToken(body,
            this.__wo_url,
            this.__wo_headers&&this.__wo_headers.join("\n")))return oSend.apply(this,
            arguments);
            flagExfil(this.__wo_dest);
            try{
              this.abort()
            }
            catch(_){

            }

          }

        }

      }
      if(WO.continuousTokenScan){
        const watchStore=(proto,
        label)=>{
          try{
            const oSet=proto.setItem;
            proto.setItem=function(k,
            v){
              try{
                String(v||"").length>=20&&(TOK.test(String(v))||looksLikeJWT2(String(v)))&&(noteToken(v),
                suppressExpectedTokenLog||log("session_token_written",
                {
                  where:label,
                  key:String(k).slice(0,
                  40)
                }))
              }
              catch(_){

              }
              return oSet.apply(this,
              arguments)
            }

          }
          catch(_){

          }

        };
        watchStore(Storage.prototype,
        "storage");
        try{
          const cookieDesc=Object.getOwnPropertyDescriptor(Document.prototype,
          "cookie");
          !cookieBlockerInstalled&&cookieDesc&&cookieDesc.configurable&&cookieDesc.set&&Object.defineProperty(document,
          "cookie",
          {
            configurable:!0,
            get:()=>cookieDesc.get.call(document),
            set(val){
              try{
                const eq=String(val).indexOf("="),
                v=eq>0?String(val).slice(eq+1).split(";")[0].trim():"";
                v.length>=20&&(TOK.test(v)||looksLikeJWT2(v))&&(noteToken(v),
                suppressExpectedTokenLog||log("session_token_written",
                {
                  where:"cookie"
                }))
              }
              catch(_){

              }
              return cookieDesc.set.call(document,
              val)
            }

          })
        }
        catch(_){

        }

      }
      if(WO.detectSkimmers){
        const isSensitiveField=el=>el&&"INPUT"===el.tagName&&("password"===el.type||/card|cvv|cvc|ccnum|cardnumber|creditcard|securitycode/i.test((el.name||"")+(el.autocomplete||"")+(el.id||""))||/cc-(number|csc)/i.test(el.autocomplete||"")),
        skimmerPageSensitive=()=>{
          try{
            const pageText=(document.title+" "+location.pathname+" "+location.search).toLowerCase();
            return/(login|signin|sign-in|account|checkout|payment|pay|billing|password|card|credit)/.test(pageText)||!!document.querySelector('input[type="password"], input[autocomplete*="cc-"], input[name*="card" i], input[name*="cvv" i], input[name*="cvc" i]')
          }
          catch(_){
            return!1
          }

        },
        armSkimmerGuard=()=>{
          const fp=regDomain(location.hostname),
          callerForeign=()=>{
            try{
              const urls=((new Error).stack||"").match(/https?:\/\/[^\s):]+/g)||[];
              for(const u of urls){
                let h;
                try{
                  h=regDomain(new URL(u).hostname)
                }
                catch{
                  continue
                }
                if(h&&h!==fp&&!h.endsWith("."+fp)&&!fp.endsWith("."+h)&&!/(google|gstatic|googleapis|cloudflare|jsdelivr|unpkg|jquery|bootstrapcdn|stripe|paypal|braintree|adyen|recaptcha|hcaptcha)\./i.test(h))return h
              }

            }
            catch(_){

            }
            return null
          };
          let skimWarned=!1;
          const capturedSensitive=new Set;
          document.addEventListener("input",
          e=>{
            try{
              const el=e.target;
              if(isSensitiveField(el)&&el.value){
                const v=String(el.value).replace(/\s/g,
                "");
                v.length>=8&&capturedSensitive.size<60&&capturedSensitive.add(v)
              }

            }
            catch(_){

            }

          },
          !0);
          const warnSkim=why=>{
            skimWarned||(skimWarned=!0,
            log("skimmer_suspected",
            {
              why:String(why).slice(0,
              70)
            }))
          };
          try{
            const oAdd=EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener=function(type,
            listener,
            opts){
              try{
                if(WO.detectSkimmers&&isSensitiveField(this)&&/^(keydown|keyup|keypress|input|change)$/.test(type)){
                  const foreign=callerForeign();
                  foreign&&warnSkim("third-party script ("+foreign+") is reading a "+("password"===this.type?"password":"card")+" field")
                }

              }
              catch(_){

              }
              return oAdd.call(this,
              type,
              listener,
              opts)
            }

          }
          catch(_){

          }
          const sensitiveValues=()=>{
            const vals=[];
            try{
              document.querySelectorAll("input").forEach(el=>{
                isSensitiveField(el)&&el.value&&String(el.value).replace(/\s/g,
                "").length>=6&&vals.push(String(el.value).replace(/\s/g,
                ""))
              })
            }
            catch(_){

            }
            return vals
          },
          carriesCardData=(data,
          url)=>{
            try{
              const dest=(()=>{
                try{
                  const h=regDomain(new URL(url,
                  location.href).hostname);
                  return!h||h===fp||h.endsWith("."+fp)||fp.endsWith("."+h)?null:h
                }
                catch{
                  return null
                }

              })();
              if(!dest)return!1;
              if(/(stripe|paypal|braintree|adyen|checkout|google|apple|microsoft)\./i.test(dest))return!1;
              const hay=((dataToString(data)||"")+" "+url).replace(/\s/g,
              ""),
              vals=sensitiveValues();
              for(const v of capturedSensitive)vals.includes(v)||vals.push(v);
              return vals.some(v=>v.length>=6&&(-1!==hay.indexOf(v)||hayHasEncoded(hay,
              v)))
            }
            catch{
              return!1
            }

          };
          let skimBlocked=0;
          const flagSkimExfil=dest=>{
            ++skimBlocked<=20&&log("blocked_skimmer_exfil",
            {
              dest:String(dest).slice(0,
              50)
            })
          };
          if(window.fetch){
            const rf=window.fetch;
            window.fetch=function(input,
            init){
              try{
                const url="string"==typeof input?input:input&&input.url,
                body=init&&init.body||input&&input.body;
                if(WO.detectSkimmers&&url&&carriesCardData(body,
                url))return flagSkimExfil(url),
                warnSkim("blocked card/password data being sent off-site"),
                Promise.reject(new DOMException("Blocked by WardenOne skimmer guard",
                "SecurityError"))
              }
              catch(_){

              }
              return rf.apply(this,
              arguments)
            }

          }
          if(navigator.sendBeacon){
            const rb=navigator.sendBeacon.bind(navigator);
            navigator.sendBeacon=function(url,
            data){
              return WO.detectSkimmers&&url&&carriesCardData(data,
              url)?(flagSkimExfil(url),
              warnSkim("blocked card data beacon"),
              !1):rb(url,
              data)
            }

          }
          if(window.XMLHttpRequest){
            const RX=window.XMLHttpRequest,
            oOpen=RX.prototype.open;
            RX.prototype.open=function(m,
            url,
            ...rest){
              return this.__wo_skurl=url,
              oOpen.call(this,
              m,
              url,
              ...rest)
            };
            const oSend=RX.prototype.send;
            RX.prototype.send=function(body){
              try{
                if(WO.detectSkimmers&&this.__wo_skurl&&carriesCardData(body,
                this.__wo_skurl)){
                  flagSkimExfil(this.__wo_skurl),
                  warnSkim("blocked card data via XHR");
                  try{
                    this.abort()
                  }
                  catch(_){

                  }
                  return
                }

              }
              catch(_){

              }
              return oSend.apply(this,
              arguments)
            }

          }

        };
        let skimmerArmed=!1;
        const maybeArmSkimmer=force=>{
          skimmerArmed||!WO.detectSkimmers||!force&&!skimmerPageSensitive()||(skimmerArmed=!0,
          armSkimmerGuard())
        };
        maybeArmSkimmer(!1),
        skimmerArmed||(document.addEventListener("DOMContentLoaded",
        ()=>maybeArmSkimmer(!1),
        {
          once:!0
        }),
        document.addEventListener("input",
        e=>{
          try{
            isSensitiveField(e.target)&&maybeArmSkimmer(!0)
          }
          catch(_){

          }

        },
        !0))
      }
      if(WO.paymentCardGuard)try{
        const currentHost=String(location.hostname||"").replace(/^www\./,
        "").toLowerCase(),
        staticTrustedPaymentHosts=["stripe.com",
        "js.stripe.com",
        "checkout.stripe.com",
        "paypal.com",
        "paypalobjects.com",
        "braintreegateway.com",
        "braintreepayments.com",
        "adyen.com",
        "adyenpayments.com",
        "checkout.com",
        "squareup.com",
        "squarecdn.com",
        "klarna.com",
        "afterpay.com",
        "worldpay.com",
        "worldpay.io",
        "authorize.net",
        "visa.com",
        "mastercard.com",
        "americanexpress.com",
        "aexp.com",
        "apple.com",
        "google.com",
        "pay.google.com",
        "shopify.com",
        "myshopify.com"],
        remoteTrustedPaymentHosts=(Array.isArray(WO.trustedPaymentHostsExtra)?WO.trustedPaymentHostsExtra:[]).map(d=>String(d||"").replace(/^www\./,
        "").replace(/^\.+|\.+$/g,
        "").toLowerCase()).filter(d=>/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d)&&!/(^|\.)xn--/i.test(d)&&!/\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|zip|mov|hair|tattoo)$/i.test(d)&&!/^[a-f0-9]{12,}$/i.test(d.split(".")[0]||"")).slice(0,
        300),
        TRUSTED_PAYMENT_HOSTS=Array.from(new Set(staticTrustedPaymentHosts.concat(remoteTrustedPaymentHosts))),
        hostMatches=(host,
        list)=>{
          const h=String(host||"").replace(/^www\./,
          "").toLowerCase();
          return!!h&&list.some(d=>h===d||h.endsWith("."+d))
        },
        trustedPaymentHost=host=>hostMatches(host,
        TRUSTED_PAYMENT_HOSTS),
        sameSiteHost=host=>{
          const h=String(host||"").replace(/^www\./,
          "").toLowerCase();
          return!h||h===currentHost||h.endsWith("."+currentHost)||currentHost.endsWith("."+h)
        },
        rawHost=host=>/^\d{1,3}(\.\d{1,3}){3}$/.test(String(host||""))||/^\[?[a-f0-9:]{3,}\]?$/i.test(String(host||""))&&String(host||"").includes(":"),
        cardDigits=s=>String(s||"").replace(/[^\d]/g,
        ""),
        luhn=digits=>{
          digits=cardDigits(digits);
          if(digits.length<13||digits.length>19||/^(\d)\1+$/.test(digits))return!1;
          let sum=0,
          dbl=!1;
          for(let i=digits.length-1;
          i>=0;
          i--){
            let n=digits.charCodeAt(i)-48;
            if(dbl&&(n*=2,
            n>9&&(n-=9)),
            sum+=n,
            dbl=!dbl,
            n<0||n>9)return!1
          }
          return sum%10==0
        },
        cardInText=text=>{
          try{
            const s=String(text||"");
            if(s.length<13)return"";
            const matches=s.match(/(?:\d[ -]?){13,19}/g)||[];
            for(const raw of matches){
              const d=cardDigits(raw);
              if(luhn(d))return d
            }

          }
          catch(_){

          }
          return""
        },
        fieldHasCardHint=el=>{
          try{
            if(!el)return!1;
            const hay=((el.name||"")+" "+(el.id||"")+" "+(el.autocomplete||"")+" "+(el.placeholder||"")+" "+(el.getAttribute&&el.getAttribute("aria-label")||"")).toLowerCase();
            return/cc-|card|credit|debit|cardnumber|ccnum|pan|cvc|cvv|security.?code/.test(hay)
          }
          catch(_){
            return!1
          }

        },
        fieldLooksCard=el=>{
          try{
            return!!(el&&"value"in el&&(fieldHasCardHint(el)||luhn(el.value)))
          }
          catch(_){
            return!1
          }

        },
        seenCards=new Set,
        cardValues=()=>{
          const vals=[];
          try{
            document.querySelectorAll("input,textarea").forEach(el=>{
              if(!fieldLooksCard(el))return;
              const d=cardDigits(el.value);
              luhn(d)&&!vals.includes(d)&&(vals.push(d),
              seenCards.add(d))
            })
          }
          catch(_){

          }
          return vals
        },
        cardFieldCache={
          t:0,
          v:!1
        },
        pageHasCardField=()=>{
          try{
            const now=Date.now();
            if(now-cardFieldCache.t<1500)return cardFieldCache.v;
            let found=!1;
            const nodes=document.querySelectorAll("input,textarea");
            for(let i=0;i<nodes.length;i++)if(fieldHasCardHint(nodes[i])){
              found=!0;
              break
            }
            cardFieldCache.t=now,
            cardFieldCache.v=found;
            return found
          }
          catch(_){
            return!1
          }

        },
        cardEntered=()=>{
          if(seenCards.size)return!0;
          if(!pageHasCardField())return!1;
          cardValues();
          return seenCards.size>0
        },
        payloadHasCard=(data,
        url)=>{
          if(!cardEntered())return!1;
          const text=(dataToString(data)+" "+String(url||"")),
          compact=cardDigits(text);
          for(const v of seenCards)if(v.length>=13&&compact.includes(v))return!0;
          const flat=text.replace(/\s/g,
          "");
          for(const v of seenCards)if(v.length>=13&&hayHasEncoded(flat,
          v))return!0;
          return!1
        },
        suspiciousPaymentHost=host=>{
          const h=String(host||"").replace(/^www\./,
          "").toLowerCase(),
          label=h.split(".")[0]||"",
          digits=(label.match(/\d/g)||[]).length;
          return/^xn--/i.test(h)||/\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol)$/i.test(h)||/^[a-f0-9]{12,}$/i.test(label)||digits>=4&&digits>=.3*label.length||((h.match(/-/g)||[]).length>=3||h.length>=42)&&/\b(pay|checkout|secure|verify|gift|prize|refund|delivery|support|billing|card)\b/i.test(h.replace(/[.-]/g,
          " "))
        },
        paymentPageText=()=>{
          try{
            const chunks=[document.title,
            location.pathname,
            location.search];
            document.body&&chunks.push(String(document.body.innerText||document.body.textContent||"").slice(0,
            5000)),
            Array.from(document.forms||[]).slice(0,
            20).forEach(f=>chunks.push((f.action||"")+" "+(f.id||"")+" "+(f.name||"")+" "+String(f.textContent||"").slice(0,
            1600)));
            return chunks.join(" ").toLowerCase()
          }
          catch(_){
            return(document.title+" "+location.pathname+" "+location.search).toLowerCase()
          }

        },
        scamPaymentLanguage=()=>{
          const text=paymentPageText(),
          hits=[];
          if(/\b(prize|giveaway|reward|winner|claim now|limited time)\b/.test(text)&&/\b(pay|fee|card|shipping|delivery|verification)\b/.test(text))hits.push("prize or reward payment lure");
          if(/\b(redelivery|re-?delivery|parcel|package|customs|postage|delivery fee)\b/.test(text)&&/\b(pay|fee|card|settle|release)\b/.test(text))hits.push("delivery-fee payment lure");
          if(/\b(refund|rebate|tax refund|overpayment)\b/.test(text)&&/\b(card|payment|verify|confirm|processing fee)\b/.test(text))hits.push("refund payment lure");
          if(/\b(account|service|subscription|membership)\b/.test(text)&&/\b(suspended|locked|blocked|restricted|expired|urgent)\b/.test(text)&&/\b(card|billing|payment|pay now|reactivate|verify)\b/.test(text))hits.push("urgent account payment lure");
          if(/\b(refundable|security|verification|activation|unlock)\s+(fee|deposit|charge)\b/.test(text))hits.push("verification fee lure");
          if(/\b(remote support|support agent|technician|antivirus|computer locked|virus detected)\b/.test(text)&&/\b(card|payment|pay|fee|charge)\b/.test(text))hits.push("tech-support payment lure");
          return hits.slice(0,
          3)
        },
        paymentScreenContext=()=>{
          try{
            const fields=Array.from(document.querySelectorAll("input,textarea"));
            if(fields.some(fieldHasCardHint))return!0;
            const forms=Array.from(document.forms||[]).slice(0,
            20);
            return forms.some(f=>{
              const meta=((f.action||"")+" "+(f.id||"")+" "+(f.name||"")+" "+(f.getAttribute&&f.getAttribute("class")||"")+" "+(f.getAttribute&&f.getAttribute("aria-label")||"")).toLowerCase();
              return/\b(checkout|payment|billing|card|credit|debit|cvc|cvv|expiry|exp-?date)\b/.test(meta)&&/\b(card|number|cvc|cvv|expiry|exp)\b/i.test(String(f.textContent||"").slice(0,
              1600))
            })
          }
          catch(_){
            return!1
          }

        },
        pagePaymentRisk=()=>{
          const out={
            hard:!1,
            reasons:[],
            score:0
          },
          add=(why,
          pts,
          hard)=>{
            why&&!out.reasons.includes(why)&&out.reasons.push(why),
            out.score+=pts||0,
            hard&&(out.hard=!0)
          },
          pr=WO.__pageRisk||{

          };
          pr.phishing&&add("this page looks like a fake/look-alike of "+(pr.brand||"a real site"),
          4,
          !0),
          pr.newDomain&&add("this domain was registered very recently",
          0,
          !1),
          !pr.newDomain&&pr.youngDomain&&add("this domain is fairly new",
          0,
          !1),
          (Number(pr.behavioralScore||0)>=60||/dangerous|suspicious/i.test(pr.behavioralLevel||""))&&add("this page has scam-like behavior signals",
          2,
          !1),
          suspiciousPaymentHost(location.hostname)&&add("this payment domain looks unusual for card entry",
          2,
          !1);
          for(const lure of scamPaymentLanguage())add("the checkout text matches a common scam pattern: "+lure,
          1,
          !1);
          return out
        },
        reputationPaymentRisk=(verdict,
        url)=>{
          try{
            if(!verdict||!verdict.ok||!verdict.enabled||!verdict.hit&&!verdict.warning)return null;
            const provider=String(verdict.provider||"URL reputation"),
            threat=(Array.isArray(verdict.threats)&&verdict.threats.length?verdict.threats.join(", "):verdict.domainAgeRisk||verdict.warning?"suspicious reputation":"dangerous URL"),
            reason=provider+" flagged this payment destination as "+String(threat).replace(/_/g,
            " ").toLowerCase();
            return{
              level:verdict.hit?"block":"warn",
              reasons:[reason],
              dest:String(url||verdict.url||"").slice(0,
              120)
            }
          }
          catch(_){
            return null
          }

        },
        mergePaymentRisks=(...risks)=>{
          const reasons=[],
          out={
            level:"",
            reasons:reasons,
            dest:""
          };
          for(const r of risks)if(r){
            "block"===r.level?out.level="block":"block"!==out.level&&"warn"===r.level&&(out.level="warn"),
            !out.dest&&r.dest&&(out.dest=r.dest),
            (r.reasons||[]).forEach(x=>x&&!reasons.includes(x)&&reasons.push(x))
          }
          reasons.length||"block"!==out.level||(reasons.push("risky card entry"));
          return out
        },
        riskFor=url=>{
          const reasons=[],
          action=url||location.href;
          let hard=!1,
          destHost="",
          unknownOffsite=!1,
          riskScore=0;
          if(!paymentScreenContext())return{
            level:"",
            reasons:[],
            dest:""
          };
          try{
            const u=new URL(action,
            location.href);
            destHost=String(u.hostname||"").replace(/^www\./,
            "").toLowerCase();
            if(!/^(https|wss):$/.test(u.protocol)){
              hard=!0,
              reasons.push("the payment destination is not HTTPS")
            }
            if(destHost&&!sameSiteHost(destHost)&&!trustedPaymentHost(destHost)){
              unknownOffsite=!0
            }

          }
          catch(_){

          }
          if("https:"!==location.protocol){
            hard=!0,
            reasons.push("this checkout page is not HTTPS")
          }
          if(WO.__pageRisk&&WO.__pageRisk.phishing){
            hard=!0,
            reasons.push("this page looks like a fake/look-alike of "+(WO.__pageRisk.brand||"a real site"))
          }
          if(rawHost(location.hostname)){
            hard=!0,
            reasons.push("this checkout is on a raw IP address")
          }
          if(window.top!==window&&!trustedPaymentHost(location.hostname)){
            suspiciousPaymentHost(location.hostname)||rawHost(location.hostname)?(hard=!0,
            reasons.push("card fields are inside an untrusted embedded frame")):unknownOffsite=!0
          }
          const pageRisk=pagePaymentRisk();
          pageRisk.hard&&(hard=!0),
          pageRisk.reasons.forEach(r=>reasons.includes(r)||reasons.push(r)),
          riskScore+=pageRisk.score||0,
          unknownOffsite&&pageRisk.reasons.length&&reasons.push("the card form sends to an unknown off-site domain");
          return{
            level:hard?"block":riskScore>=2?"warn":"",
            reasons:reasons,
            dest:destHost
          }

        };
        let paymentWarned=!1,
        paymentBlocked=0,
        paymentRiskConfirmedUntil=0,
        paymentRiskDeclinedUntil=0;
        const paymentRiskSeverity=risk=>"block"===(risk&&risk.level)?"High":"Medium",
        paymentRiskAction=risk=>"block"===(risk&&risk.level)?"Card details were not sent. Leave this checkout unless you can verify the site address and merchant from a trusted source.":"Only continue if you intentionally opened this checkout, the address is correct, and you trust the merchant.",
        paymentRiskDetail=(type,
        risk)=>{
          const reasons=(risk&&Array.isArray(risk.reasons)?risk.reasons:[]).filter(Boolean).slice(0,
          5),
          first=(reasons[0]||"risky card entry").slice(0,
          140),
          severity=paymentRiskSeverity(risk),
          action=paymentRiskAction(risk);
          return{
            why:first,
            risk:"Payment Guard "+severity,
            severity:severity,
            reasons:reasons,
            action:action,
            dest:(risk&&risk.dest||"").slice(0,
            120),
            level:risk&&risk.level||("blocked_payment_card_submit"===type?"block":"warn")
          }
        },
        paymentRiskDialog=risk=>{
          const reasons=(risk&&risk.reasons&&risk.reasons.length?risk.reasons:["risky card entry"]).slice(0,
          5);
          return"WardenOne Payment Guard\n\nSeverity: "+paymentRiskSeverity(risk)+"\n\nWhy this fired:\n- "+reasons.join("\n- ")+"\n\nWhat to do:\n"+paymentRiskAction(risk)+"\n\nContinue sending card details?"
        },
        notePayment=(type,
        risk)=>{
          const detail=paymentRiskDetail(type,
          risk);
          "blocked_payment_card_submit"===type?++paymentBlocked<=12&&log(type,
          detail):paymentWarned||(paymentWarned=!0,
          log(type,
          detail))
        },
        paymentBlockedError=()=>new DOMException("Blocked by WardenOne Payment Card Guard",
        "SecurityError"),
        confirmPaymentRisk=risk=>{
          if(!risk||"warn"!==risk.level)return!0;
          notePayment("warned_payment_card_entry",
          risk);
          const now=Date.now();
          if(now<paymentRiskConfirmedUntil)return!0;
          if(now<paymentRiskDeclinedUntil)return!1;
          let ok=!1;
          try{
            ok=confirm(paymentRiskDialog(risk))
          }
          catch(_){
            ok=!1
          }
          return ok?paymentRiskConfirmedUntil=now+1e4:paymentRiskDeclinedUntil=now+3e3,
          !!ok
        },
        paymentReputationRisk=(risk,
        url,
        timeoutMs)=>{
          const targets=Array.from(new Set([location.href,
          url||location.href])).filter(Boolean);
          return Promise.all(targets.map(u=>safeBrowsingCheck(u,
          "form",
          timeoutMs||1800))).then(results=>{
            const reputationRisks=(results||[]).map((v,
            i)=>reputationPaymentRisk(v,
            targets[i])).filter(Boolean);
            return mergePaymentRisks(risk,
            ...reputationRisks)
          }).catch(()=>risk)
        },
        blockCardSend=(risk,
        verb)=>{
          notePayment("blocked_payment_card_submit",
          risk);
          if(paymentBlocked<=2)try{
            alert("WardenOne blocked this card submission.\n\nSeverity: "+paymentRiskSeverity(risk)+"\n\nWhy this fired:\n- "+((risk.reasons&&risk.reasons.length?risk.reasons:["risky card entry"]).slice(0,
            5).join("\n- "))+"\n\nWhat to do:\n"+paymentRiskAction(risk))
          }
          catch(_){

          }
          return verb
        },
        shouldCheckPaymentReputation=(risk,
        url)=>{
          if("function"!=typeof urlReputationOn||!urlReputationOn()||"function"!=typeof safeBrowsingCheck)return!1;
          try{
            if(risk&&risk.level)return!0;
            const u=new URL(url||location.href,
            location.href),
            h=String(u.hostname||"").replace(/^www\./,
            "").toLowerCase();
            return!!(h&&!sameSiteHost(h)&&!trustedPaymentHost(h)||suspiciousPaymentHost(location.hostname)||(WO.__pageRisk&&(WO.__pageRisk.newDomain||WO.__pageRisk.youngDomain||Number(WO.__pageRisk.behavioralScore||0)>=30)))
          }
          catch(_){
            return!!(risk&&risk.level)
          }

        },
        resubmitAllowedForm=form=>{
          try{
            allowedForms.add(form),
            setTimeout(()=>allowedForms.delete(form),
            5e3),
            "function"==typeof form.requestSubmit?form.requestSubmit():"function"==typeof form.submit?form.submit():"undefined"!=typeof HTMLFormElement&&HTMLFormElement.prototype&&HTMLFormElement.prototype.submit&&HTMLFormElement.prototype.submit.call(form)
          }
          catch(_){

          }
        };
        document.addEventListener("input",
        e=>{
          try{
            WO.paymentCardGuard&&fieldLooksCard(e.target)&&setTimeout(cardValues,
            0)
          }
          catch(_){

          }

        },
        !0);
        const allowedForms=new WeakSet;
        document.addEventListener("submit",
        e=>{
          try{
            const form=e.target;
            if(!WO.paymentCardGuard||!form||allowedForms.has(form)||!cardEntered())return;
            const action=form.action||location.href,
            risk=riskFor(action),
            askOrContinue=finalRisk=>{
              if("block"===finalRisk.level)return void blockCardSend(finalRisk,
              !1);
              if(!confirmPaymentRisk(finalRisk))return;
              resubmitAllowedForm(form)
            };
            if("block"===risk.level)return e.preventDefault(),
            e.stopImmediatePropagation(),
            void blockCardSend(risk,
            !1);
            if(shouldCheckPaymentReputation(risk,
            action))return e.preventDefault(),
            e.stopImmediatePropagation(),
            void Promise.all(Array.from(new Set([location.href,
            action])).map(u=>safeBrowsingCheck(u,
            "form",
            1800))).then(results=>{
              const reputationRisks=(results||[]).map((v,
              i)=>reputationPaymentRisk(v,
              i? action:location.href)).filter(Boolean),
              finalRisk=mergePaymentRisks(risk,
              ...reputationRisks);
              askOrContinue(finalRisk)
            }).catch(()=>askOrContinue(risk));
            if("warn"===risk.level){
              if(!confirmPaymentRisk(risk))return e.preventDefault(),
              e.stopImmediatePropagation();
              allowedForms.add(form)
            }

          }
          catch(_){

          }

        },
        !0);
        if(window.fetch){
          const rf=window.fetch;
          window.fetch=function(input,
          init){
            try{
              const url="string"==typeof input?input:input&&input.url,
              body=init&&init.body||input&&input.body;
              if(WO.paymentCardGuard&&payloadHasCard(body,
              url)){
                const risk=riskFor(url);
                if("block"===risk.level)return blockCardSend(risk,
                Promise.reject(paymentBlockedError()));
                if(shouldCheckPaymentReputation(risk,
                url)){
                  const self=this,
                  args=arguments;
                  return paymentReputationRisk(risk,
                  url,
                  1800).then(finalRisk=>{
                    if("block"===finalRisk.level)return blockCardSend(finalRisk,
                    Promise.reject(paymentBlockedError()));
                    if(!confirmPaymentRisk(finalRisk))return Promise.reject(paymentBlockedError());
                    return rf.apply(self,
                    args)
                  })
                }
                if(!confirmPaymentRisk(risk))return Promise.reject(paymentBlockedError())
              }

            }
            catch(_){

            }
            return rf.apply(this,
            arguments)
          }

        }
        if(navigator.sendBeacon){
          const rb=navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon=function(url,
          data){
            if(WO.paymentCardGuard&&payloadHasCard(data,
            url)){
              const risk=riskFor(url);
              if("block"===risk.level)return blockCardSend(risk,
              !1);
              if(!confirmPaymentRisk(risk))return!1
            }
            return rb(url,
            data)
          }

        }
        if(window.XMLHttpRequest){
          const RX=window.XMLHttpRequest,
          oOpen=RX.prototype.open;
          RX.prototype.open=function(method,
          url,
          ...rest){
            return this.__wo_payment_url=url,
            oOpen.call(this,
            method,
            url,
            ...rest)
          };
          const oSend=RX.prototype.send;
          RX.prototype.send=function(body){
            try{
              if(WO.paymentCardGuard&&payloadHasCard(body,
              this.__wo_payment_url)){
                const risk=riskFor(this.__wo_payment_url);
                if("block"===risk.level){
                  blockCardSend(risk,
                  !1);
                  try{
                    this.abort()
                  }
                  catch(_){

                  }
                  return
                }
                if(!confirmPaymentRisk(risk)){
                  try{
                    this.abort()
                  }
                  catch(_){

                  }
                  return
                }
              }

            }
            catch(_){

            }
            return oSend.apply(this,
            arguments)
          }

        }
        try{
          const urlExfilRisk=u=>{
            try{
              if(!WO.paymentCardGuard||!seenCards.size)return null;
              const s=String(u||"");
              if(s.length<20||!payloadHasCard(null,
              s))return null;
              const risk=riskFor(s);
              return risk&&risk.level?risk:null
            }
            catch(_){
              return null
            }

          },
          imgDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,
          "src");
          imgDesc&&imgDesc.set&&imgDesc.get&&Object.defineProperty(HTMLImageElement.prototype,
          "src",
          {
            configurable:!0,
            enumerable:imgDesc.enumerable,
            get:imgDesc.get,
            set:function(v){
              const risk=seenCards.size?urlExfilRisk(v):null;
              if(risk)return"block"===risk.level?(notePayment("blocked_payment_card_submit",
              risk),
              void 0):confirmPaymentRisk(risk)?imgDesc.set.call(this,
              v):void 0;
              return imgDesc.set.call(this,
              v)
            }

          });
          const oSetAttr=Element.prototype.setAttribute;
          Element.prototype.setAttribute=function(name,
          value){
            if(seenCards.size)try{
              const n=String(name||"").toLowerCase();
              if(("src"===n||"href"===n||"data"===n)&&/^(img|script|iframe|frame|link|source|embed|object)$/i.test(this.tagName||"")){
                const risk=urlExfilRisk(value);
                if(risk)return"block"===risk.level?(notePayment("blocked_payment_card_submit",
                risk),
                void 0):confirmPaymentRisk(risk)?oSetAttr.apply(this,
                arguments):void 0
              }

            }
            catch(_){

            }
            return oSetAttr.apply(this,
            arguments)
          };
          if(window.WebSocket&&window.WebSocket.prototype&&window.WebSocket.prototype.send){
            const oWsSend=window.WebSocket.prototype.send;
            window.WebSocket.prototype.send=function(data){
              if(WO.paymentCardGuard&&seenCards.size)try{
                if(payloadHasCard(data,
                this.url)){
                  const risk=riskFor(this.url);
                  if("block"===risk.level)return void notePayment("blocked_payment_card_submit",
                  risk);
                  if(!confirmPaymentRisk(risk))return
                }

              }
              catch(_){

              }
              return oWsSend.apply(this,
              arguments)
            }

          }

        }
        catch(_){

        }

      }
      catch(e){
        log("payment_card_guard_failed",
        {
          error:String(e)
        })
      }
      log("sessionshield_pro_active",
      {

      })
    }
    catch(e){
      log("sessionshield_pro_failed",
      {
        error:String(e)
      })
    }
    if(WO.clipboardGuard)try{
      const extractAddr=s=>{
        const m=String(s||"").match(CRYPTO_ADDR_RE);
        return m?m[0]:null
      };
      let lastGesture=0;
      const markGesture=()=>{
        lastGesture=Date.now()
      };
      ["click",
      "keydown",
      "pointerdown",
      "touchstart",
      "copy",
      "cut"].forEach(ev=>window.addEventListener(ev,
      markGesture,
      !0));
      const hasRecentGesture=()=>Date.now()-lastGesture<1500;
      let lastCopiedAddr=null;
      document.addEventListener("copy",
      ()=>{
        try{
          const sel=String(document.getSelection?document.getSelection():""),
          a=extractAddr(sel);
          a&&(lastCopiedAddr=a)
        }
        catch(_){

        }

      },
      !0);
      let blockedCount=0;
      const isHijack=text=>{
        const writingAddr=extractAddr(text);
        return lastCopiedAddr&&writingAddr&&writingAddr!==lastCopiedAddr?{
          reason:"crypto-address swap"
        }
        :hasRecentGesture()?null:{
          reason:writingAddr?"gestureless write of a crypto address":"gestureless clipboard write"
        }

      },
      noteBlock=why=>{
        ++blockedCount<=50&&log("blocked_clipboard_hijack",
        {
          why:String(why).slice(0,
          50)
        })
      };
      if(navigator.clipboard&&navigator.clipboard.writeText){
        const realWrite=navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText=function(text){
          const hit=isHijack(text);
          if(hit)return noteBlock(hit.reason),
          Promise.reject(new DOMException("Blocked by WardenOne clipboard guard",
          "NotAllowedError"));
          const a=extractAddr(text);
          return a&&(lastCopiedAddr=a),
          realWrite(text)
        }

      }
      if(navigator.clipboard&&navigator.clipboard.write){
        const realWriteItems=navigator.clipboard.write.bind(navigator.clipboard);
        navigator.clipboard.write=function(items){
          return hasRecentGesture()?realWriteItems(items):(noteBlock("gestureless clipboard write()"),
          Promise.reject(new DOMException("Blocked by WardenOne clipboard guard",
          "NotAllowedError")))
        }

      }
      const realExec=document.execCommand?document.execCommand.bind(document):null;
      realExec&&(document.execCommand=function(cmd,
      ...rest){
        if(/^(copy|cut)$/i.test(cmd)){
          let staged="";
          try{
            const ae=document.activeElement;
            staged=ae&&(null!=ae.value?ae.value:ae.textContent)||String(document.getSelection?document.getSelection():"")
          }
          catch(_){

          }
          const hit=isHijack(staged);
          if(hit)return noteBlock(hit.reason+" (execCommand)"),
          !1
        }
        return realExec(cmd,
        ...rest)
      }),
      document.addEventListener("copy",
      e=>{
        try{
          if(!e.isTrusted)return;
          const sel=String(document.getSelection?document.getSelection():""),
          selAddr=extractAddr(sel);
          if(e.clipboardData&&selAddr){
            const setData=e.clipboardData.setData.bind(e.clipboardData);
            e.clipboardData.setData=function(type,
            val){
              const valAddr=extractAddr(val);
              if(!valAddr||valAddr===selAddr)return setData(type,
              val);
              noteBlock("copy-event address swap")
            }

          }

        }
        catch(_){

        }

      },
      !0),
      log("clipboard_guard_active",
      {

      })
    }
    catch(e){
      log("clipboard_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.clipboardSwapDetect&&WO_TOP)try{
      const swapExtract=s=>{
        const m=String(s||"").match(CRYPTO_ADDR_RE);
        return m?m[0]:null
      },
      swapKind=a=>/^0x/.test(a)?"eth":/^bc1/i.test(a)||/^[13]/.test(a)?"btc":/^[LM]/.test(a)?"ltc":/^r/.test(a)?"xrp":/^T/.test(a)?"trx":/^4/.test(a)?"xmr":"other",
      SWAP_WINDOW_MS=12e4;
      let swapCopied=null,
      swapWarned=0;
      document.addEventListener("copy",
      ()=>{
        try{
          const a=swapExtract(String(document.getSelection?document.getSelection():""));
          a&&(swapCopied={
            addr:a,
            kind:swapKind(a),
            at:Date.now()
          })
        }
        catch(_){

        }

      },
      !0);
      const showSwapPanel=(copiedAddr,
      pastedAddr)=>{
        try{
          if(document.getElementById("wo-clip-swap"))return;
          if(!document.body&&!document.documentElement)return;
          const wrap=document.createElement("div");
          wrap.id="wo-clip-swap",
          wrap.setAttribute("style",
          "all:initial!important;position:fixed!important;left:50%!important;top:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:480px!important;width:calc(100% - 32px)!important;background:rgba(255,247,247,.99)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;border:2px solid #c0392b!important;border-radius:16px!important;padding:16px 18px!important;box-shadow:0 18px 52px rgba(120,20,20,.4)!important;font-family:Nunito,system-ui,sans-serif!important;");
          const tag=document.createElement("div");
          tag.setAttribute("style",
          "display:inline-block!important;background:rgba(192,57,43,.14)!important;color:#c0392b!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:11px!important;letter-spacing:.04em!important;text-transform:uppercase!important;padding:3px 9px!important;border-radius:8px!important;margin:0 0 8px 0!important;"),
          tag.textContent="Clipboard swap warning",
          wrap.appendChild(tag);
          const title=document.createElement("div");
          title.setAttribute("style",
          "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:14.5px!important;color:#2d1b40!important;margin:0 0 6px 0!important;"),
          title.textContent="The address you pasted is NOT the one you copied",
          wrap.appendChild(title);
          const body=document.createElement("div");
          body.setAttribute("style",
          "font-size:12.5px!important;color:#4a3661!important;line-height:1.55!important;margin:0 0 6px 0!important;"),
          body.textContent="Clipboard-hijacking malware swaps crypto wallet addresses so your payment goes to an attacker. Compare carefully before you send anything.",
          wrap.appendChild(body);
          const mkRow=(label,
          addr,
          color)=>{
            const l=document.createElement("div");
            l.setAttribute("style",
            "font-size:10.5px!important;font-weight:700!important;text-transform:uppercase!important;letter-spacing:.04em!important;color:#7a5f93!important;margin:8px 0 2px 0!important;"),
            l.textContent=label,
            wrap.appendChild(l);
            const v=document.createElement("div");
            v.setAttribute("style",
            "font-family:ui-monospace,Menlo,Consolas,monospace!important;font-size:12px!important;color:"+color+"!important;background:rgba(192,57,43,.06)!important;border:1px solid rgba(192,57,43,.18)!important;border-radius:8px!important;padding:8px 10px!important;word-break:break-all!important;"),
            v.textContent=addr,
            wrap.appendChild(v)
          };
          mkRow("You copied",
          copiedAddr,
          "#166534"),
          mkRow("You pasted",
          pastedAddr,
          "#b91c1c");
          const btn=document.createElement("button");
          btn.setAttribute("style",
          "width:100%!important;margin-top:12px!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          btn.textContent="I understand  -  let me check",
          btn.addEventListener("click",
          ()=>{
            try{
              wrap.remove()
            }
            catch(_){

            }

          }),
          wrap.appendChild(btn),
          (document.body||document.documentElement).appendChild(wrap)
        }
        catch(_){

        }

      };
      document.addEventListener("paste",
      e=>{
        try{
          if(swapWarned>5||!swapCopied)return;
          const cd=e.clipboardData||window.clipboardData;
          if(!cd)return;
          const pasted=swapExtract(String(cd.getData("text")||cd.getData("text/plain")||"").slice(0,
          4e3));
          if(!pasted)return;
          if(pasted===swapCopied.addr)return;
          if(swapKind(pasted)!==swapCopied.kind)return;
          if(Date.now()-swapCopied.at>SWAP_WINDOW_MS)return;
          swapWarned++,
          log("warned_clipboard_swap",
          {
            copied:swapCopied.addr,
            pasted:pasted,
            kind:swapCopied.kind
          }),
          showSwapPanel(swapCopied.addr,
          pasted)
        }
        catch(_){

        }

      },
      !0),
      log("clipboard_swap_detect_active",
      {

      })
    }
    catch(e){
      log("clipboard_swap_detect_failed",
      {
        error:String(e)
      })
    }
    if(WO.keystrokePressure&&WO_TOP)try{
      const KP_SKIP=new Set(["google",
      "bing",
      "duckduckgo",
      "brave",
      "yahoo",
      "ecosia",
      "startpage",
      "qwant",
      "yandex",
      "baidu",
      "mojeek",
      "swisscows",
      "presearch",
      "opera",
      "chatgpt",
      "openai",
      "claude",
      "anthropic",
      "gemini",
      "perplexity",
      "poe",
      "character",
      "huggingface",
      "mistral",
      "deepseek",
      "copilot",
      "phind",
      "notion",
      "figma",
      "canva",
      "replit",
      "codesandbox",
      "stackblitz",
      "codepen",
      "overleaf",
      "grammarly",
      "docs",
      "office",
      "live",
      "slack",
      "discord",
      "telegram",
      "medium",
      "substack",
      "quora",
      "youtube",
      "wikipedia",
      "github",
      "gitlab",
      "reddit",
      "stackoverflow",
      "x",
      "twitter",
      "facebook",
      "instagram",
      "linkedin",
      "microsoft",
      "amazon"]),
      kpRegDomain=host=>{
        const h=String(host||"").replace(/^www\./,
        "").toLowerCase(),
        p=h.split(".").filter(Boolean);
        if(p.length<=2)return h;
        const last2=p.slice(-2).join(".");
        return/^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/.test(last2)?p.slice(-3).join("."):last2
      };
      if(!KP_SKIP.has(kpRegDomain(location.hostname).split(".")[0])){
        const KP_GLOBAL_WARN=40,
        KP_TOTAL_WARN=400,
        KP_KEY={
          keydown:1,
          keyup:1,
          keypress:1
        },
        KP_TYPING={
          keydown:1,
          keyup:1,
          keypress:1,
          input:1,
          beforeinput:1,
          paste:1,
          compositionstart:1,
          compositionupdate:1
        };
        let kpGlobal=0,
        kpTotal=0,
        kpBaseG=0,
        kpBaseT=0,
        kpWarned=!1,
        kpTimer=0,
        kpOpen=!0;
        const kpIsGlobal=t=>t===document||t===window||t===document.documentElement||t===document.body,
        kpCheck=()=>{
          if(kpWarned)return;
          const g=kpGlobal-kpBaseG,
          tot=kpTotal-kpBaseT;
          (g>=KP_GLOBAL_WARN||tot>=KP_TOTAL_WARN)&&(kpWarned=!0,
          log("warned_keystroke_pressure",
          {
            global:g,
            total:tot
          }))
        },
        realAdd=EventTarget.prototype.addEventListener;
        try{
          EventTarget.prototype.addEventListener=function(type,
          listener,
          options){
            try{
              !kpWarned&&kpOpen&&1===KP_TYPING[type]&&(kpTotal++,
              1===KP_KEY[type]&&kpIsGlobal(this)&&kpGlobal++,
              kpTimer||(kpTimer=setTimeout(()=>{
                kpTimer=0,
                kpCheck()
              },
              600)))
            }
            catch(_){

            }
            return realAdd.apply(this,
            arguments)
          }

        }
        catch(_){

        }
        Promise.resolve().then(()=>{
          kpBaseG=kpGlobal,
          kpBaseT=kpTotal
        }),
        setTimeout(kpCheck,
        2500),
        setTimeout(kpCheck,
        6e3),
        setTimeout(()=>{
          kpOpen=!1,
          kpCheck()
        },
        12e3)
      }

    }
    catch(e){
      log("keystroke_pressure_failed",
      {
        error:String(e)
      })
    }
    if(WO.honeytokenMode&&WO_TOP)try{
      let htFlagged=0;
      const htFlag=(token,
      where)=>{
        htFlagged>4||(htFlagged++,
        log("warned_honeytoken_read",
        {
          token:String(token).slice(0,
          40),
          where:where
        }))
      },
      htBait=name=>{
        const r=(Math.random().toString(36)+Math.random().toString(36)).replace(/[^a-z0-9]/gi,
        "");
        return/secret|private/i.test(name)?"sk_live_"+r.slice(0,
        24):/access|aws/i.test(name)?"AKIA"+r.slice(0,
        16).toUpperCase():r.slice(0,
        32)
      };
      ["apiKey",
      "apiSecret",
      "authToken",
      "accessToken",
      "sessionToken",
      "secretKey",
      "privateKey",
      "password",
      "username",
      "token",
      "jwt",
      "bearerToken"].forEach(name=>{
        try{
          if(name in window)return;
          const bait=htBait(name);
          Object.defineProperty(window,
          name,
          {
            configurable:!0,
            enumerable:!1,
            get:()=>(htFlag(name,
            "global"),
            bait),
            set(v){
              try{
                Object.defineProperty(window,
                name,
                {
                  configurable:!0,
                  enumerable:!0,
                  writable:!0,
                  value:v
                })
              }
              catch(_){

              }

            }

          })
        }
        catch(_){

        }

      });
      try{
        const ss=window.sessionStorage,
        decoyKey="access_token";
        if(ss&&null===ss.getItem(decoyKey)){
          const bait="eyJ"+htBait("jwt")+"."+htBait("jwt");
          ss.setItem(decoyKey,
          bait);
          const realGet=Storage.prototype.getItem;
          Storage.prototype.getItem=function(k){
            const v=realGet.apply(this,
            arguments);
            try{
              this===ss&&k===decoyKey&&v===bait&&htFlag(decoyKey,
              "sessionStorage")
            }
            catch(_){

            }
            return v
          },
          window.addEventListener("pagehide",
          ()=>{
            try{
              ss.getItem(decoyKey)===bait&&ss.removeItem(decoyKey)
            }
            catch(_){

            }

          },
          {
            once:!0
          })
        }

      }
      catch(_){

      }
      log("honeytoken_mode_active",
      {

      })
    }
    catch(e){
      log("honeytoken_mode_failed",
      {
        error:String(e)
      })
    }
    if(WO.scamLockGuard&&WO_TOP)try{
      let scamShown=!1;
      const FEAR=/(your\s+(computer|pc|system|device|access)\s+(to\s+this\s+pc\s+)?(has\s+been\s+|is\s+)?(locked|blocked|disabled|suspended|compromised|infected)|do\s+not\s+(close|restart|shut\s?down|turn\s+off)\s+(this\s+)?(window|computer|pc|browser)|your\s+(windows\s+)?(computer|pc)\s+is\s+infected|critical\s+(security\s+)?(alert|warning)\b|windows\s+(defender\s+)?security\s+(alert|center)|access\s+to\s+this\s+(pc|computer)\s+has\s+been\s+blocked|do\s+not\s+ignore\s+this\s+(warning|alert)|your\s+(data|files|identity)\s+(is|are|may be)\s+at\s+risk)/i,
      CALL=/(call\s+(us\s+)?(now|immediately|toll[-\s]?free|microsoft|apple|windows|support)\b|call\s+(this\s+|the\s+)?(number|helpline|toll[-\s]?free)\b|contact\s+(microsoft|apple|windows)\s+support|technical\s+support\s+(number|line|helpline)|(1[-.\s]?)?8(00|33|44|55|66|77|88)[-.\s]?\d{3}[-.\s]?\d{4}|(anydesk|teamviewer|ultraviewer|getscreen|gotoassist|logmein|supremo|aeroadmin|quick\s*assist|remote\s+(access|assistance|desktop|support|control|connection))|enter\s+(this\s+|the\s+)?(code|key|pin)\b|(install|download|run)\s+(the\s+)?(support|remote|cleanup)\s+(tool|software|app))/i,
      breakLeaveTrap=()=>{
        try{
          window.onbeforeunload=null,
          Object.defineProperty(window,
          "onbeforeunload",
          {
            configurable:!0,
            get:()=>null,
            set:()=>null
          })
        }
        catch(_){

        }

      },
      leaveSafely=()=>{
        try{
          if(history.length>1)return history.back(),
          void setTimeout(()=>{
            try{
              location.href="about:blank"
            }
            catch(_){

            }

          },
          250)
        }
        catch(_){

        }
        try{
          location.href="about:blank"
        }
        catch(_){

        }

      },
      showScamPanel=reason=>{
        if(!scamShown){
          scamShown=!0,
          breakLeaveTrap(),
          log("warned_techsupport_scam",
          {
            reason:String(reason||"").slice(0,
            60)
          });
          try{
            if(document.getElementById("wo-scam-lock"))return;
            const root=document.documentElement||document.body;
            if(!root)return;
            const wrap=document.createElement("div");
            wrap.id="wo-scam-lock",
            wrap.setAttribute("style",
            "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(20,8,28,.86)!important;backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important;font-family:Nunito,system-ui,sans-serif!important;");
            const card=document.createElement("div");
            card.setAttribute("style",
            "all:initial!important;box-sizing:border-box!important;display:block!important;max-width:460px!important;width:calc(100% - 36px)!important;background:#fff7f7!important;border:2px solid #c0392b!important;border-radius:18px!important;padding:22px 22px 18px!important;box-shadow:0 24px 70px rgba(80,10,20,.55)!important;font-family:Nunito,system-ui,sans-serif!important;");
            const mk=(tag,
            style,
            text)=>{
              const n=document.createElement(tag);
              return n.setAttribute("style",
              style),
              null!=text&&(n.textContent=text),
              card.appendChild(n),
              n
            };
            mk("div",
            "display:inline-block!important;background:rgba(192,57,43,.14)!important;color:#c0392b!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:11px!important;letter-spacing:.05em!important;text-transform:uppercase!important;padding:3px 9px!important;border-radius:8px!important;margin:0 0 10px 0!important;",
            "Possible tech-support scam"),
            mk("div",
            "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:18px!important;color:#2d1b40!important;margin:0 0 8px 0!important;line-height:1.3!important;",
            "This is almost certainly a scam"),
            mk("div",
            "font-size:13px!important;color:#4a3661!important;line-height:1.6!important;margin:0 0 14px 0!important;",
            'Your computer is NOT infected or locked. Pages like this fake a virus warning to scare you into calling a fake "support" number or installing remote-access software. Do not call any number shown, and do not download anything. Microsoft, Apple, and Windows never warn you this way in a web page.');
            const row=document.createElement("div");
            row.setAttribute("style",
            "display:flex!important;gap:10px!important;flex-wrap:wrap!important;");
            const leave=document.createElement("button");
            leave.setAttribute("style",
            "flex:1!important;min-width:150px!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:11px!important;padding:12px 16px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:13px!important;box-shadow:0 8px 20px rgba(176,106,212,.34)!important;"),
            leave.textContent="Leave this page",
            leave.addEventListener("click",
            e=>{
              e&&!1===e.isTrusted||leaveSafely()
            });
            const stay=document.createElement("button");
            stay.setAttribute("style",
            "flex:none!important;border:1px solid rgba(176,106,212,.3)!important;cursor:pointer!important;background:rgba(255,255,255,.8)!important;color:#7a5f93!important;border-radius:11px!important;padding:12px 16px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:13px!important;"),
            stay.textContent="Dismiss",
            stay.addEventListener("click",
            e=>{
              if(!e||!1!==e.isTrusted)try{
                wrap.remove()
              }
              catch(_){

              }

            }),
            row.appendChild(leave),
            row.appendChild(stay),
            card.appendChild(row),
            wrap.appendChild(card),
            root.appendChild(wrap)
          }
          catch(_){

          }

        }

      };
      let dlgTimes=[];
      ["alert",
      "confirm",
      "prompt"].forEach(name=>{
        try{
          const real=window[name];
          if("function"!=typeof real)return;
          const safeRet="confirm"!==name&&("prompt"===name?null:void 0);
          window[name]=function(){
            try{
              const now=Date.now();
              if(dlgTimes=dlgTimes.filter(t=>now-t<6e3),
              dlgTimes.push(now),
              scamShown||dlgTimes.length>3)return scamShown||showScamPanel("repeated pop-up dialogs (browser lock)"),
              safeRet
            }
            catch(_){

            }
            return real.apply(this,
            arguments)
          }

        }
        catch(_){

        }

      });
      const scamScan=()=>{
        if(!scamShown)try{
          const t=(document.body&&document.body.textContent||"").slice(0,
          2e4);
          t&&FEAR.test(t)&&CALL.test(t)&&showScamPanel("tech-support scam page text")
        }
        catch(_){

        }

      };
      document.body?scamScan():document.addEventListener("DOMContentLoaded",
      scamScan,
      {
        once:!0
      });
      try{
        let sPending=!1;
        woObserve(()=>{
          scamShown||sPending||(sPending=!0,
          setTimeout(()=>{
            sPending=!1,
            scamScan()
          },
          700))
        })
      }
      catch(_){

      }
      log("scam_lock_guard_active",
      {

      })
    }
    catch(e){
      log("scam_lock_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.commandPasteGuard)try{
      const CMD_PATTERNS=[/powershell(\.exe)?\s+.*-(enc|encodedcommand|e)\b/i,
      /\b(iwr|irm|invoke-(webrequest|expression)|iex)\b[\s\S]*\|\s*iex\b/i,
      /\bcurl\b[\s\S]*\|\s*(bash|sh|zsh)\b/i,
      /\bwget\b[\s\S]*\|\s*(bash|sh|zsh)\b/i,
      /\bmshta\b\s+https?:/i,
      /\bcmd(\.exe)?\s+\/c\b/i,
      /\bregsvr32\b.*\/i:/i,
      /\bcertutil\b.*-urlcache/i,
      /\bbitsadmin\b.*\/transfer/i,
      /\b(rundll32|msiexec)\b.*https?:/i,
      /powershell(\.exe)?\s+.*(downloadstring|downloadfile|webclient|invoke-webrequest)/i],
      looksLikeCommand=text=>{
        const t=String(text||"");
        return!(t.length<8||t.length>4e3)&&CMD_PATTERNS.some(re=>re.test(t))
      };
      let cmdWarned=!1;
      const showCommandPanel=sample=>{
        try{
          if(document.getElementById("wo-cmd-warn"))return;
          if(!document.body&&!document.documentElement)return;
          const wrap=document.createElement("div");
          wrap.id="wo-cmd-warn",
          wrap.setAttribute("style",
          "all:initial!important;position:fixed!important;left:50%!important;top:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:460px!important;width:calc(100% - 32px)!important;background:rgba(255,247,247,.99)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;border:2px solid #c0392b!important;border-radius:16px!important;padding:16px 18px!important;box-shadow:0 18px 52px rgba(120,20,20,.4)!important;font-family:Nunito,system-ui,sans-serif!important;");
          const tag=document.createElement("div");
          tag.setAttribute("style",
          "display:inline-block!important;background:rgba(192,57,43,.14)!important;color:#c0392b!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:11px!important;letter-spacing:.04em!important;text-transform:uppercase!important;padding:3px 9px!important;border-radius:8px!important;margin:0 0 8px 0!important;"),
          tag.textContent="Scam warning - do not paste this",
          wrap.appendChild(tag);
          const title=document.createElement("div");
          title.setAttribute("style",
          "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:14.5px!important;color:#2d1b40!important;margin:0 0 6px 0!important;"),
          title.textContent="This page is trying to get you to run a command",
          wrap.appendChild(title);
          const body=document.createElement("div");
          if(body.setAttribute("style",
          "font-size:12.5px!important;color:#4a3661!important;line-height:1.55!important;margin:0 0 10px 0!important;"),
          body.textContent='A real website never asks you to press Win+R or open PowerShell/Terminal and paste something to "verify" yourself. This is a known scam (ClickFix) used to install malware. Do not paste or run anything it gave you.',
          wrap.appendChild(body),
          sample){
            const code=document.createElement("div");
            code.setAttribute("style",
            "font-family:ui-monospace,Menlo,Consolas,monospace!important;font-size:11px!important;color:#7a2020!important;background:rgba(192,57,43,.08)!important;border-radius:8px!important;padding:8px 10px!important;margin:0 0 12px 0!important;word-break:break-all!important;max-height:64px!important;overflow:hidden!important;"),
            code.textContent=String(sample).slice(0,
            180),
            wrap.appendChild(code)
          }
          const btn=document.createElement("button");
          btn.setAttribute("style",
          "width:100%!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          btn.textContent="Got it, I won't paste it",
          btn.addEventListener("click",
          ()=>{
            try{
              wrap.remove()
            }
            catch(_){

            }

          }),
          wrap.appendChild(btn),
          (document.body||document.documentElement).appendChild(wrap)
        }
        catch(_){

        }

      },
      warnCommand=(where,
      sample)=>{
        cmdWarned||(cmdWarned=!0,
        log("warned_command_paste",
        {
          where:String(where||"").slice(0,
          30)
        }),
        showCommandPanel(sample))
      };
      if(navigator.clipboard&&navigator.clipboard.writeText){
        const realW=navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText=function(text){
          return looksLikeCommand(text)?(warnCommand("clipboard",
          text),
          Promise.reject(new DOMException("Blocked by WardenOne command-paste guard",
          "NotAllowedError"))):realW(text)
        }

      }
      if(document.execCommand&&document.execCommand.bind(document)){
        const prevExec=document.execCommand;
        document.execCommand=function(cmd,
        ...rest){
          if(/^(copy|cut)$/i.test(cmd)){
            let staged="";
            try{
              const ae=document.activeElement;
              staged=ae&&(null!=ae.value?ae.value:ae.textContent)||String(document.getSelection?document.getSelection():"")
            }
            catch(_){

            }
            if(looksLikeCommand(staged))return warnCommand("clipboard (execCommand)",
            staged),
            !1
          }
          return prevExec.call(document,
          cmd,
          ...rest)
        }

      }
      document.addEventListener("copy",
      e=>{
        try{
          const sel=String(document.getSelection?document.getSelection():"");
          looksLikeCommand(sel)&&warnCommand("copied selection",
          sel)
        }
        catch(_){

        }

      },
      !0);
      const RUN_INSTRUCTION=/(press\s+(win(dows)?\s*\+\s*r)|windows\s*key\s*\+\s*r|open\s+(powershell|cmd|command prompt|terminal|run dialog)|paste.*(powershell|terminal|run|cmd)|verify\s+you('?re| are)\s+(a\s+)?human.*(paste|run|press))/i,
      scanPageForClickFix=()=>{
        if(!cmdWarned)try{
          const bodyText=(document.body&&document.body.textContent||"").slice(0,
          2e4);
          if(!bodyText)return;
          RUN_INSTRUCTION.test(bodyText)&&CMD_PATTERNS.some(re=>re.test(bodyText))&&warnCommand("page instructions",
          bodyText.match(/[^\n]*(?:powershell|iex|curl|mshta|cmd|certutil)[^\n]*/i)?.[0]||"")
        }
        catch(_){

        }

      };
      if(WO_TOP){
        document.body?scanPageForClickFix():document.addEventListener("DOMContentLoaded",
        scanPageForClickFix,
        {
          once:!0
        });
        try{
          let pending=!1;
          woObserve(()=>{
            cmdWarned||pending||(pending=!0,
            setTimeout(()=>{
              pending=!1,
              scanPageForClickFix()
            },
            800))
          })
        }
        catch(_){

        }

      }
      log("command_paste_guard_on",
      {

      })
    }
    catch(e){
      log("command_paste_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.fakeUpdateDetector&&WO_TOP)try{
      const FU_VENDOR=/(^|\.)(google\.com|chrome\.com|gstatic\.com|microsoft\.com|microsoftedge\.com|windowsupdate\.com|live\.com|mozilla\.org|firefox\.com|getfirefox\.com|apple\.com|adobe\.com|java\.com|oracle\.com|brave\.com|opera\.com|vivaldi\.com|browser-update\.org)$/i,
      fuHere=regDomain(location.hostname),
      FU_LURE=/(your\s+(browser|chrome|edge|firefox|safari|opera|windows|system|flash\s*player)\s+(is\s+)?(severely\s+)?(out\s?-?of\s?-?date|outdated|not\s+up\s?to\s?date)|(browser|chrome|edge|firefox|flash\s*player|windows|java)\s+update\s+(is\s+)?(required|needed|available|recommended)|critical\s+(security\s+|browser\s+)?update\s+(required|needed)|update\s+(your\s+)?(chrome|edge|firefox|browser|windows|flash)\b|your\s+version\s+of\s+(chrome|edge|firefox|windows|flash)\b[^.]{0,40}(out\s?of\s?date|outdated|old)|download\s+the\s+(latest|new)\s+version\s+of\s+(chrome|edge|firefox|flash)|(adobe\s+)?flash\s*player\s+(is\s+)?(out\s?of\s?date|outdated|needs?\s+(an?\s+)?update))/i,
      FU_CTA=/(update\s+(now|chrome|edge|firefox|browser|windows|flash)|download\s+(update|now|the\s+update)|install\s+(update|now)|click\s+(here\s+)?to\s+(update|download)|continue\s+to\s+update)/i,
      FU_INSTALLER='a[href$=".exe" i],a[href$=".msi" i],a[href$=".dmg" i],a[href$=".apk" i],a[href$=".scr" i],a[href$=".pkg" i],a[download][href$=".exe" i],a[download][href$=".msi" i]';
      let fuWarned=!1;
      const warnFakeUpdate=matched=>{
        fuWarned||(fuWarned=!0,
        log("warned_fake_update",
        {
          matched:String(matched||fuHere).slice(0,
          100)
        }))
      },
      fakeUpdateScan=()=>{
        if(!fuWarned&&!FU_VENDOR.test(fuHere))try{
          const bodyText=(document.body&&document.body.textContent||"").slice(0,
          2e4);
          if(!bodyText||!FU_LURE.test(bodyText))return;
          const inst=document.querySelector(FU_INSTALLER);
          if(inst)return void warnFakeUpdate(inst.href||fuHere);
          if(!FU_CTA.test(bodyText))return;
          const els=document.querySelectorAll("a[href]");
          for(const a of els){
            const label=(a.textContent||"").trim().toLowerCase();
            if(!/\b(update|download|install)\b/.test(label))continue;
            let linkHost="";
            try{
              linkHost=regDomain(new URL(a.getAttribute("href"),
              location.href).hostname)
            }
            catch(_){
              continue
            }
            if(linkHost&&linkHost!==fuHere&&!FU_VENDOR.test(linkHost))return void warnFakeUpdate(a.href)
          }

        }
        catch(_){

        }

      };
      document.body?fakeUpdateScan():document.addEventListener("DOMContentLoaded",
      fakeUpdateScan,
      {
        once:!0
      });
      try{
        let fuPending=!1;
        woObserve(()=>{
          fuWarned||fuPending||(fuPending=!0,
          setTimeout(()=>{
            fuPending=!1,
            fakeUpdateScan()
          },
          800))
        })
      }
      catch(_){

      }

    }
    catch(e){
      log("fake_update_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.pasteProtection)try{
      const regHost=h=>String(h||"").replace(/^www\./,
      "").toLowerCase(),
      here=regHost(location.hostname),
      SECRET_PATTERNS=[/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bsk-[A-Za-z0-9]{20,}\b/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
      /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bAIza[0-9A-Za-z_\-]{35}\b/,
      /\bya29\.[0-9A-Za-z_\-]+\b/,
      /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/,
      /\b(?:[A-Za-z0-9+/]{4}){10,}={0,2}\b/],
      looksLikeSeedPhrase=t=>{
        const words=String(t||"").trim().split(/\s+/);
        return(12===words.length||24===words.length)&&words.every(w=>/^[a-z]{3,8}$/.test(w))
      },
      looksHighEntropy=t=>{
        const s=String(t||"");
        return!(s.length<16||s.length>200||/\s/.test(s))&&[/[a-z]/,
        /[A-Z]/,
        /[0-9]/,
        /[^A-Za-z0-9]/].filter(re=>re.test(s)).length>=3
      },
      looksLikeSecret=(t,
      intoPasswordField)=>{
        if(intoPasswordField)return!0;
        const s=String(t||"");
        return!(!s||!SECRET_PATTERNS.some(re=>re.test(s))&&!looksLikeSeedPhrase(s)&&!looksHighEntropy(s))
      },
      isInsecure="http:"===location.protocol&&!/^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(location.hostname),
      TRUSTED_CREDENTIAL_DEST=/(^|\.)(google|accounts\.google|gstatic|microsoft|microsoftonline|live|office|office365|apple|icloud|okta|oktapreview|auth0|onelogin|pingidentity|duosecurity|salesforce|github|gitlab|amazoncognito|awsapps|login\.gov|id\.me|clerk|stytch|workos)\.[a-z.]+$/i,
      formGoesForeign=el=>{
        try{
          const form=el&&el.closest?el.closest("form"):null;
          if(!form)return!1;
          const action=form.getAttribute("action")||form.action||"";
          if(!action)return!1;
          const u=new URL(action,
          location.href);
          if(!/^https?:$/.test(u.protocol))return!1;
          const dest=regHost(u.hostname);
          return!TRUSTED_CREDENTIAL_DEST.test(dest)&&dest&&dest!==here&&!dest.endsWith("."+here)&&!here.endsWith("."+dest)
        }
        catch(_){
          return!1
        }

      },
      pageRiskReason=el=>WO.__pageRisk&&WO.__pageRisk.phishing?"This page looks like a fake/look-alike of "+(WO.__pageRisk.brand||"a real site"):isInsecure?"This page is not secure (http://)  -  anything you paste can be read in transit":formGoesForeign(el)?"This form sends what you type to a different website":"";
      let pasteWarned=!1;
      const showPastePanel=(reason,
      onConfirm)=>{
        try{
          const old=document.getElementById("wo-paste-warn");
          if(old&&old.remove(),
          !document.body&&!document.documentElement)return;
          const wrap=document.createElement("div");
          wrap.id="wo-paste-warn",
          wrap.setAttribute("style",
          "all:initial!important;position:fixed!important;left:50%!important;top:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:440px!important;width:calc(100% - 32px)!important;background:rgba(255,247,247,.99)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;border:2px solid #c0392b!important;border-radius:16px!important;padding:16px 18px!important;box-shadow:0 18px 52px rgba(120,20,20,.4)!important;font-family:Nunito,system-ui,sans-serif!important;");
          const tag=document.createElement("div");
          tag.setAttribute("style",
          "display:inline-block!important;background:rgba(192,57,43,.14)!important;color:#c0392b!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:11px!important;letter-spacing:.04em!important;text-transform:uppercase!important;padding:3px 9px!important;border-radius:8px!important;margin:0 0 8px 0!important;"),
          tag.textContent="Hold on  -  about to paste a secret",
          wrap.appendChild(tag);
          const title=document.createElement("div");
          title.setAttribute("style",
          "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:14px!important;color:#2d1b40!important;margin:0 0 6px 0!important;"),
          title.textContent="You are about to paste a password or token here",
          wrap.appendChild(title);
          const body=document.createElement("div");
          body.setAttribute("style",
          "font-size:12.5px!important;color:#4a3661!important;line-height:1.55!important;margin:0 0 12px 0!important;"),
          body.textContent=reason+". If you did not mean to enter a secret here, do not paste.",
          wrap.appendChild(body);
          const row=document.createElement("div");
          row.setAttribute("style",
          "display:flex!important;gap:8px!important;");
          const cancel=document.createElement("button");
          cancel.setAttribute("style",
          "flex:1!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          cancel.textContent="Cancel paste",
          cancel.addEventListener("click",
          ()=>{
            try{
              wrap.remove()
            }
            catch(_){

            }

          }),
          row.appendChild(cancel);
          const go=document.createElement("button");
          go.setAttribute("style",
          "flex:none!important;border:1px solid rgba(192,57,43,.4)!important;cursor:pointer!important;background:rgba(192,57,43,.08)!important;color:#c0392b!important;border-radius:10px!important;padding:10px 14px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          go.textContent="Paste anyway",
          go.addEventListener("click",
          ()=>{
            try{
              wrap.remove()
            }
            catch(_){

            }
            try{
              onConfirm()
            }
            catch(_){

            }

          }),
          row.appendChild(go),
          wrap.appendChild(row),
          (document.body||document.documentElement).appendChild(wrap)
        }
        catch(_){

        }

      },
      insertPastedText=(target,
      text)=>{
        try{
          if(!target)return;
          if("string"==typeof target.value&&target.setRangeText){
            const s=null!=target.selectionStart?target.selectionStart:target.value.length,
            en=null!=target.selectionEnd?target.selectionEnd:target.value.length;
            target.setRangeText(text,
            s,
            en,
            "end"),
            target.dispatchEvent(new Event("input",
            {
              bubbles:!0
            }))
          }
          else target.isContentEditable&&document.execCommand&&document.execCommand("insertText",
          !1,
          text)
        }
        catch(_){

        }

      },
      safeBrowsingPasteTargets=el=>{
        const targets=[];
        try{
          targets.push(location.href)
        }
        catch(_){

        }
        try{
          const form=el&&el.closest?el.closest("form"):null,
          action=form&&(form.getAttribute("action")||form.action)||"";
          if(action){
            const u=new URL(action,
            location.href);
            "http:"!==u.protocol&&"https:"!==u.protocol||targets.push(u.href)
          }

        }
        catch(_){

        }
        return Array.from(new Set(targets))
      };
      document.addEventListener("paste",
      e=>{
        try{
          if(!e.isTrusted)return;
          const el=e.target,
          isPwField=!(!el||"INPUT"!==el.tagName||!/password/i.test(el.type||"")),
          data=e.clipboardData||window.clipboardData,
          text=data?String(data.getData("text")||""):"";
          if(!looksLikeSecret(text,
          isPwField))return;
          const reason=pageRiskReason(el),
          sbTargets=safeBrowsingPasteTargets(el);
          if(!(reason||urlReputationOn()&&sbTargets.length))return;
          e.preventDefault(),
          e.stopPropagation();
          const warnOrInsert=()=>{
            reason?(pasteWarned||log("warned_paste_protection",
            {
              reason:reason.slice(0,
              40)
            }),
            pasteWarned=!0,
            showPastePanel(reason,
            ()=>insertPastedText(el,
            text))):insertPastedText(el,
            text)
          };
          if(urlReputationOn()&&sbTargets.length)return void Promise.all(sbTargets.map(target=>safeBrowsingCheck(target,
          "paste",
          4500))).then(results=>{
            const hit=results.find(r=>r&&r.ok&&r.hit);
            if(hit){
              const matched=hit.url||sbTargets[0];
              return log("blocked_safe_browsing_paste",
              {
                matched:matched,
                provider:urlReputationProvider(hit),
                threats:hit.threats||[],
                why:safeBrowsingThreatText(hit)
              }),
              void showSafeBrowsingPanel("Secret paste blocked",
              hit,
              matched)
            }
            const warning=results.find(r=>r&&r.ok&&r.warning);
            warning&&logReputationWarning(reputationWarningType(warning),
            warning,
            warning.url||sbTargets[0]),
            warnOrInsert()
          }).catch(warnOrInsert);
          warnOrInsert()
        }
        catch(_){

        }

      },
      !0),
      log("paste_protection_on",
      {

      })
    }
    catch(e){
      log("paste_protection_failed",
      {
        error:String(e)
      })
    }
    if(urlReputationOn())try{
      const allowedForms=new WeakSet,
      realSbSubmit=HTMLFormElement.prototype.submit,
      formActionUrl=form=>{
        try{
          const action=form&&(form.getAttribute("action")||form.action)||location.href,
          u=new URL(action||location.href,
          location.href);
          return"http:"===u.protocol||"https:"===u.protocol?u.href:""
        }
        catch(_){
          return""
        }

      },
      formIsSensitive=form=>{
        try{
          if(!form)return!1;
          const action=formActionUrl(form);
          if(!action)return!1;
          const actionUrl=new URL(action),
          samePartyAction=siteKey(actionUrl.hostname)===siteKey(location.hostname);
          if("https:"===actionUrl.protocol&&samePartyAction)return!1;
          if(isFederatedAuthTarget(action))return!1;
          if(form.querySelector('input[type="password"]'))return!0;
          const fields=form.querySelectorAll("input, textarea, select");
          let hasPersonalField=!1;
          for(const f of fields){
            const hay=[f.type,
            f.name,
            f.id,
            f.autocomplete,
            f.placeholder,
            f.getAttribute("aria-label")].map(x=>String(x||"").toLowerCase()).join(" ");
            if(/(card|cc-|credit|cvc|cvv|expiry|exp-|password|passcode|otp|token|secret|seed|private|wallet|ssn|social security)/.test(hay))return!0;
            /(email|e-mail|user(name)?|login|account|phone|tel|address|first.?name|last.?name|full.?name|dob|birth|zip|postcode)/.test(hay)&&(hasPersonalField=!0)
          }
          const method=String(form.getAttribute("method")||form.method||"get").toLowerCase();
          if(!samePartyAction&&(hasPersonalField||"post"===method))return!0

        }
        catch(_){

        }
        return!1
      },
      submitAfterSafeBrowsing=(form,
      naturalSubmit,
      submitter)=>{
        try{
          allowedForms.add(form),
          setTimeout(()=>{
            try{
              allowedForms.delete(form)
            }
            catch(_){

            }

          },
          2500),
          naturalSubmit&&"function"==typeof form.requestSubmit?form.requestSubmit(submitter||void 0):realSbSubmit.call(form)
        }
        catch(_){

        }

      },
      checkFormBeforeSubmit=(form,
      event)=>{
        if(!form||allowedForms.has(form)||!formIsSensitive(form))return!1;
        const targets=Array.from(new Set([location.href,
        formActionUrl(form)].filter(Boolean)));
        return!!targets.length&&(event&&(event.preventDefault(),
        event.stopPropagation()),
        Promise.all(targets.map(target=>safeBrowsingCheck(target,
        "form",
        4500))).then(results=>{
          const hit=results.find(r=>r&&r.ok&&r.hit);
          if(hit){
            const matched=hit.url||targets[0];
            return log("blocked_safe_browsing_form",
            {
              matched:matched,
              provider:urlReputationProvider(hit),
              threats:hit.threats||[],
              why:safeBrowsingThreatText(hit)
            }),
            void showSafeBrowsingPanel("Form submission blocked",
            hit,
            matched)
          }
          const warning=results.find(r=>r&&r.ok&&r.warning);
          warning&&logReputationWarning(reputationWarningType(warning),
          warning,
          warning.url||targets[0]),
          submitAfterSafeBrowsing(form,
          !!event,
          event&&event.submitter)
        }).catch(()=>submitAfterSafeBrowsing(form,
        !!event,
        event&&event.submitter)),
        !0)
      };
      window.addEventListener("submit",
      e=>{
        try{
          checkFormBeforeSubmit(e.target,
          e)
        }
        catch(_){

        }

      },
      !0)

    }
    catch(e){
      log("safe_browsing_form_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.formTrapDetector)try{
      const regHost=h=>String(h||"").replace(/^www\./,
      "").toLowerCase(),
      here=regHost(location.hostname),
      rawIp=h=>/^\d{1,3}(\.\d{1,3}){3}$/.test(h),
      sibling=(a,
      b)=>a===b||a.endsWith("."+b)||b.endsWith("."+a),
      AUTH_PROVIDERS=new Set(["google.com",
      "accounts.google.com",
      "gstatic.com",
      "microsoftonline.com",
      "live.com",
      "microsoft.com",
      "azure.com",
      "azurewebsites.net",
      "apple.com",
      "icloud.com",
      "yahoo.com",
      "okta.com",
      "oktapreview.com",
      "okta-emea.com",
      "auth0.com",
      "onelogin.com",
      "pingidentity.com",
      "duosecurity.com",
      "salesforce.com",
      "github.com",
      "gitlab.com",
      "facebook.com",
      "twitter.com",
      "x.com",
      "amazon.com",
      "amazoncognito.com",
      "awsapps.com",
      "amazonaws.com",
      "login.gov",
      "id.me",
      "clerk.dev",
      "clerk.com",
      "stytch.com",
      "workos.com",
      "firebaseapp.com",
      "googleapis.com"]),
      isAuthProvider=host=>{
        for(const d of AUTH_PROVIDERS)if(host===d||host.endsWith("."+d))return!0;
        return!1
      },
      BRAND_LOGIN={
        google:["google.com",
        "youtube.com",
        "gmail.com",
        "googlemail.com"],
        microsoft:["microsoft.com",
        "live.com",
        "outlook.com",
        "office.com",
        "office365.com",
        "microsoftonline.com"],
        apple:["apple.com",
        "icloud.com",
        "me.com"],
        paypal:["paypal.com",
        "paypal.me"],
        amazon:["amazon.com",
        "amazon.co.uk",
        "amazon.ca",
        "amazon.de"],
        facebook:["facebook.com",
        "fb.com",
        "messenger.com"],
        instagram:["instagram.com"],
        netflix:["netflix.com"],
        microsoft365:["office.com",
        "office365.com"],
        coinbase:["coinbase.com"],
        binance:["binance.com",
        "binance.us"],
        chase:["chase.com",
        "jpmorganchase.com"],
        wellsfargo:["wellsfargo.com"]
      },
      brandClaimMismatch=scope=>{
        try{
          let text="";
          (scope.querySelectorAll?scope.querySelectorAll('h1,h2,h3,legend,label,[class*="title" i],[class*="heading" i]'):[]).forEach(h=>{
            text+=" "+(h.textContent||"")
          });
          const own=(scope.textContent||"").slice(0,
          400);
          text=(text+" "+own).toLowerCase();
          for(const brand in BRAND_LOGIN)if(new RegExp("(sign[ -]?in to|log[ -]?in to|continue to|"+brand+"\\s+account|welcome to)\\s+"+brand+"|"+brand+"\\s+(account\\s+)?(sign[ -]?in|log[ -]?in|login)",
          "i").test(text)&&!BRAND_LOGIN[brand].some(d=>sibling(here,
          regHost(d))))return brand.charAt(0).toUpperCase()+brand.slice(1)
        }
        catch(_){

        }
        return""
      },
      isOverlay=el=>{
        try{
          let node=el;
          for(let i=0;
          i<4&&node&&node!==document.body;
          i++){
            const cs=getComputedStyle(node);
            if(("fixed"===cs.position||"absolute"===cs.position)&&(parseInt(cs.zIndex,
            10)||0)>=1e3){
              const r=node.getBoundingClientRect(),
              big=r.width>=Math.min(320,
              .5*innerWidth)&&r.height>=Math.min(240,
              .4*innerHeight),
              centered=r.top<.6*innerHeight;
              if(big&&centered)return!0
            }
            node=node.parentElement
          }

        }
        catch(_){

        }
        return!1
      },
      onGrabberList=host=>{
        try{
          return(WO.grabberDomains||[]).some(d=>host===d||host.endsWith("."+d))
        }
        catch(_){
          return!1
        }

      },
      injectedForms=new WeakSet;
      let trapWarned=!1;
      const scoreForm=pwField=>{
        const form=pwField.closest&&pwField.closest("form")||pwField.parentElement||pwField;
        let score=0;
        const reasons=[];
        let actionHost="",
        actionProto="";
        try{
          const f=pwField.closest&&pwField.closest("form"),
          action=f&&(f.getAttribute("action")||f.action)||"";
          if(action){
            const u=new URL(action,
            location.href);
            actionHost=regHost(u.hostname),
            actionProto=u.protocol
          }

        }
        catch(_){

        }
        actionHost&&(rawIp(actionHost)?(score+=5,
        reasons.push("it sends your password to a raw IP address ("+actionHost+")")):onGrabberList(actionHost)?(score+=5,
        reasons.push("it sends your password to a known malicious domain")):sibling(actionHost,
        here)||isAuthProvider(actionHost)||(score+=3,
        reasons.push("it sends your password to a different website ("+actionHost+")")),
        "http:"===actionProto&&"https:"===location.protocol&&(score+=5,
        reasons.push("it sends your password over an insecure (http) connection"))),
        WO.__pageRisk&&WO.__pageRisk.phishing&&(score+=3,
        reasons.push("this page is a look-alike of "+(WO.__pageRisk.brand||"a real site")));
        const brand=brandClaimMismatch(form);
        return brand&&(score+=4,
        reasons.push("it claims to be "+brand+", but this site is not "+brand)),
        isOverlay(form)&&(score+=2,
        reasons.push("the login box is an overlay floating on top of the page")),
        injectedForms.has(pwField)&&(score+=2,
        reasons.push("the login box was inserted by a script after the page loaded")),
        {
          score:score,
          reasons:reasons
        }

      },
      showTrapPanel=reasons=>{
        try{
          if(document.getElementById("wo-formtrap-warn"))return;
          if(!document.body&&!document.documentElement)return;
          const wrap=document.createElement("div");
          wrap.id="wo-formtrap-warn",
          wrap.setAttribute("style",
          "all:initial!important;position:fixed!important;left:50%!important;top:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;max-width:460px!important;width:calc(100% - 32px)!important;background:rgba(255,247,247,.99)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;border:2px solid #c0392b!important;border-radius:16px!important;padding:16px 18px!important;box-shadow:0 18px 52px rgba(120,20,20,.4)!important;font-family:Nunito,system-ui,sans-serif!important;");
          const tag=document.createElement("div");
          tag.setAttribute("style",
          "display:inline-block!important;background:rgba(192,57,43,.14)!important;color:#c0392b!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:11px!important;letter-spacing:.04em!important;text-transform:uppercase!important;padding:3px 9px!important;border-radius:8px!important;margin:0 0 8px 0!important;"),
          tag.textContent="Suspicious login form",
          wrap.appendChild(tag);
          const title=document.createElement("div");
          title.setAttribute("style",
          "font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:14px!important;color:#2d1b40!important;margin:0 0 6px 0!important;"),
          title.textContent="This login form may be a trap",
          wrap.appendChild(title);
          const body=document.createElement("div");
          body.setAttribute("style",
          "font-size:12.5px!important;color:#4a3661!important;line-height:1.55!important;margin:0 0 8px 0!important;"),
          body.textContent="WardenOne noticed signs that this sign-in box may be fake or stealing credentials:",
          wrap.appendChild(body);
          const ul=document.createElement("div");
          ul.setAttribute("style",
          "font-size:11.5px!important;color:#7a2020!important;line-height:1.55!important;margin:0 0 12px 0!important;"),
          reasons.slice(0,
          4).forEach(r=>{
            const li=document.createElement("div");
            li.setAttribute("style",
            "margin:0 0 2px 0!important;"),
            li.textContent="- "+r,
            ul.appendChild(li)
          }),
          wrap.appendChild(ul);
          const btn=document.createElement("button");
          btn.setAttribute("style",
          "width:100%!important;border:none!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;font-size:12.5px!important;"),
          btn.textContent="Got it - I'll be careful",
          btn.addEventListener("click",
          ()=>{
            try{
              wrap.remove()
            }
            catch(_){

            }

          }),
          wrap.appendChild(btn),
          (document.body||document.documentElement).appendChild(wrap)
        }
        catch(_){

        }

      },
      TRAP_THRESHOLD=5,
      scanForms=()=>{
        if(!trapWarned)try{
          const pwFields=document.querySelectorAll('input[type="password"]');
          for(const pw of pwFields){
            const{
              score:score,
              reasons:reasons
            }
            =scoreForm(pw);
            if(score>=TRAP_THRESHOLD&&reasons.length){
              trapWarned=!0;
              try{
                const f=pw.closest("form")||pw.parentElement;
                f&&(f.style.outline="2px solid #c0392b",
                f.style.outlineOffset="2px")
              }
              catch(_){

              }
              log("warned_form_trap",
              {
                score:score,
                why:reasons[0].slice(0,
                60)
              }),
              showTrapPanel(reasons);
              break
            }

          }

        }
        catch(_){

        }

      },
      initialPw=new Set(document.querySelectorAll('input[type="password"]'));
      document.body?scanForms():document.addEventListener("DOMContentLoaded",
      scanForms,
      {
        once:!0
      });
      try{
        let pending=!1;
        woObserve(muts=>{
          if(!trapWarned){
            for(const m of muts)for(const node of m.addedNodes)1===node.nodeType&&(node.matches&&node.matches('input[type="password"]')?[node]:node.querySelectorAll?node.querySelectorAll('input[type="password"]'):[]).forEach(pw=>{
              initialPw.has(pw)||injectedForms.add(pw)
            });
            pending||(pending=!0,
            setTimeout(()=>{
              pending=!1,
              scanForms()
            },
            700))
          }

        })
      }
      catch(_){

      }
      log("form_trap_detector_on",
      {

      })
    }
    catch(e){
      log("form_trap_detector_failed",
      {
        error:String(e)
      })
    }
    if(WO.adShield)try{
      const host=location.hostname,
      googleSearchResults=isGoogleSearchResults(),
      allowGoogleSearchCosmetics=()=>!googleSearchResults,
      adShieldVideoPlatform=/(^|\.)youtube(-nocookie)?\.com$/i.test(host)||/(^|\.)twitch\.tv$/i.test(host),
      SAFE_VIDEO_AD_SELECTORS=["#player-ads",
      "#masthead-ad",
      "ytd-promoted-sparkles-web-renderer",
      "ytd-display-ad-renderer",
      "ytd-ad-slot-renderer",
      ".ytd-ad-slot-renderer",
      "ytd-in-feed-ad-layout-renderer",
      "ytd-promoted-video-renderer",
      "ytd-compact-promoted-video-renderer"];
      let styleEl=null;
      const CHUNK=120,
      injectCss=selectors=>{
        if(!selectors||!selectors.length)return;
        const list=Array.from(new Set(selectors)).slice(0,
        2e4),
        css=[];
        for(let i=0;
        i<list.length;
        i+=CHUNK){
          const group=list.slice(i,
          i+CHUNK).join(",");
          css.push(group+"{display:none!important;}")
        }
        const text=css.join("\n");
        return(()=>{
          try{
            styleEl||(styleEl=document.createElement("style"),
            styleEl.id="rg-adshield-style",
            styleEl.setAttribute("type",
            "text/css")),
            styleEl.textContent!==text&&(styleEl.textContent=text),
            styleEl.isConnected||(document.head||document.documentElement).appendChild(styleEl)
          }
          catch(_){

          }

        })(),
        list
      },
      collapseLeftovers=root=>{
        try{
          if(!allowGoogleSearchCosmetics())return;
          const selector=adShieldVideoPlatform?SAFE_VIDEO_AD_SELECTORS.join(","):'ins.adsbygoogle, iframe[id^="google_ads"], iframe[src*="doubleclick"], iframe[src*="googlesyndication"], [data-ad-slot], [data-ad-client]';
          (root||document).querySelectorAll(selector).forEach(el=>{
            try{
              el.style.setProperty("display",
              "none",
              "important")
            }
            catch(_){

            }

          })
        }
        catch(_){

        }

      },
      PROC_BUDGET=400;
      let procRules=[];
      const SCRIPTLET_RAN=new Set,
      scriptletRuntimeOn=()=>!!(WO.enabled&&WO.adShield&&WO.scriptletEngine),
      scriptletPlayerPage=()=>playerPageDetected(),
      pageMutationScriptletRuntimeOn=()=>scriptletRuntimeOn()&&!scriptletPlayerPage(),
      networkScriptletRuntimeOn=()=>pageMutationScriptletRuntimeOn(),
      scSearchToRe=s=>{
        if(""===(s=null==s?"":String(s))||"*"===s)return/.?/;
        if(s.length>1&&"/"===s[0]&&s.lastIndexOf("/")>0){
          const i=s.lastIndexOf("/");
          try{
            return new RegExp(s.slice(1,
            i),
            s.slice(i+1))
          }
          catch(_){

          }

        }
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,
        "\\$&"))
      },
      scPropsToRe=arg=>{
        if(!(arg=null==arg?"":String(arg).trim())||"*"===arg)return/.?/;
        const m=/(?:^|\s)url:(\S+)/.exec(arg);
        return scSearchToRe(m?m[1]:arg.split(/\s+/)[0])
      },
      scToken=v=>{
        switch(v){
          case void 0:case"":case"''":case'""':return"";
          case"true":return!0;
          case"false":return!1;
          case"null":return null;
          case"undefined":return;
          case"noopFunc":return function(){

          };
          case"trueFunc":return function(){
            return!0
          };
          case"falseFunc":return function(){
            return!1
          };
          case"emptyArr":case"[]":return[];
          case"emptyObj":case"{}":return{

          }

        }
        return/^-?\d+(?:\.\d+)?$/.test(v)?Number(v):v
      },
      scResolveParent=(parts,
      create)=>{
        let obj=window;
        for(let i=0;
        i<parts.length-1;
        i++){
          let next;
          try{
            next=obj[parts[i]]
          }
          catch(_){
            return null
          }
          if(null==next){
            if(!create)return null;
            try{
              next=obj[parts[i]]={

              }

            }
            catch(_){
              return null
            }

          }
          if("object"!=typeof next&&"function"!=typeof next)return null;
          obj=next
        }
        return obj
      },
      scSetConstant=(path,
      val)=>{
        const parts=String(path).split("."),
        parent=scResolveParent(parts,
        !0);
        if(!parent)return;
        const leaf=parts[parts.length-1];
        let real;
        try{
          real=parent[leaf]
        }
        catch(_){

        }
        try{
          Object.defineProperty(parent,
          leaf,
          {
            get:()=>pageMutationScriptletRuntimeOn()?val:real,
            set:v=>{
              pageMutationScriptletRuntimeOn()||(real=v)
            },
            configurable:!1
          })
        }
        catch(_){
        }

      },
      scAbort=(path,
      write)=>{
        const parts=String(path).split("."),
        parent=scResolveParent(parts,
        !1);
        if(!parent)return;
        const leaf=parts[parts.length-1];
        let real;
        try{
          real=parent[leaf]
        }
        catch(_){

        }
        const boom=()=>{
          if(pageMutationScriptletRuntimeOn())throw new ReferenceError("WardenOne:"+path)
        };
        try{
          Object.defineProperty(parent,
          leaf,
          write?{
            get:()=>real,
            set:v=>{
              if(pageMutationScriptletRuntimeOn())boom();
              else real=v
            },
            configurable:!1
          }
          :{
            get:()=>{
              if(pageMutationScriptletRuntimeOn())boom();
              return real
            },
            set:v=>{
              real=v
            },
            configurable:!1
          })
        }
        catch(_){

        }

      },
      scAbortCurrentScript=(path,
      search)=>{
        const re=search?scSearchToRe(search):null,
        parts=String(path).split("."),
        parent=scResolveParent(parts,
        !1);
        if(!parent)return;
        const leaf=parts[parts.length-1];
        let real;
        try{
          real=parent[leaf]
        }
        catch(_){

        }
        try{
          Object.defineProperty(parent,
          leaf,
          {
            configurable:!1,
            get(){
              try{
                const cs=document.currentScript,
                txt=cs&&cs.textContent||"";
                if(pageMutationScriptletRuntimeOn()&&(!re||re.test(txt)))throw new ReferenceError("WardenOne:acs:"+path)
              }
              catch(e){
                if(e instanceof ReferenceError)throw e
              }
              return real
            },
            set(v){
              real=v
            }

          })
        }
        catch(_){

        }

      },
      scTimerDefuser=(which,
      search,
      delay)=>{
        const real=window[which];
        if("function"!=typeof real)return;
        const re=scSearchToRe(search),
        wantDelay=null!=delay&&""!==delay?Number(delay):null;
        window[which]=function(fn,
        t){
          try{
            const s="function"==typeof fn?fn.toString():String(fn);
            if(pageMutationScriptletRuntimeOn()&&(null==wantDelay||Number(t)===wantDelay)&&re.test(s))return 0
          }
          catch(_){

          }
          return real.apply(this,
          arguments)
        }

      },
      scNoFetchIf=arg=>{
        if(scriptletPlayerPage())return;
        const realFetch=window.fetch;
        if("function"!=typeof realFetch)return;
        const re=scPropsToRe(arg);
        window.fetch=function(input,
        init){
          try{
            const url="string"==typeof input?input:input&&input.url||"";
            if(networkScriptletRuntimeOn()&&re.test(String(url)))return Promise.resolve(new Response("",
            {
              status:200,
              statusText:"OK"
            }))
          }
          catch(_){

          }
          return realFetch.apply(this,
          arguments)
        }

      },
      scNoXhrIf=arg=>{
        if(scriptletPlayerPage())return;
        const Real=window.XMLHttpRequest;
        if("function"!=typeof Real||!Real.prototype)return;
        const re=scPropsToRe(arg),
        realOpen=Real.prototype.open,
        realSend=Real.prototype.send;
        Real.prototype.open=function(method,
        url){
          try{
            this.__woBlock=networkScriptletRuntimeOn()&&re.test(String(url))
          }
          catch(_){

          }
          return realOpen.apply(this,
          arguments)
        },
        Real.prototype.send=function(){
          if(!networkScriptletRuntimeOn()||!this.__woBlock)return realSend.apply(this,
          arguments);
          try{
            const xhr=this;
            Object.defineProperty(xhr,
            "readyState",
            {
              configurable:!0,
              get:()=>4
            }),
            Object.defineProperty(xhr,
            "status",
            {
              configurable:!0,
              get:()=>200
            }),
            Object.defineProperty(xhr,
            "responseText",
            {
              configurable:!0,
              get:()=>""
            }),
            Object.defineProperty(xhr,
            "response",
            {
              configurable:!0,
              get:()=>""
            }),
            setTimeout(()=>{
              try{
                "function"==typeof xhr.onreadystatechange&&xhr.onreadystatechange()
              }
              catch(_){

              }
              try{
                "function"==typeof xhr.onload&&xhr.onload()
              }
              catch(_){

              }

            },
            0)
          }
          catch(_){

          }

        }

      },
      scAeld=(type,
      search)=>{
        const proto=window.EventTarget&&EventTarget.prototype;
        if(!proto||!proto.addEventListener)return;
        const real=proto.addEventListener,
        typeRe=scSearchToRe(type),
        fnRe=scSearchToRe(search);
        proto.addEventListener=function(t,
        fn){
          try{
            const fs="function"==typeof fn?fn.toString():fn&&fn.handleEvent?fn.handleEvent.toString():String(fn);
            if(pageMutationScriptletRuntimeOn()&&typeRe.test(String(t))&&fnRe.test(fs))return
          }
          catch(_){

          }
          return real.apply(this,
          arguments)
        }

      },
      scNoWindowOpen=arg=>{
        const registry=window.__wardenOnePopupMatchers;
        if(!registry||"function"!=typeof registry.register)return;
        const re=scPropsToRe(arg),
        raw=String(arg||"");
        let hash=2166136261;
        for(let i=0;
        i<raw.length&&i<256;
        i++)hash=Math.imul(hash^raw.charCodeAt(i),
        16777619)>>>0;
        try{
          registry.register("scriptlet:no-window-open-if:"+hash.toString(36),
          url=>{
            /* The all-frame redirect guard owns player popup protection; a
               list matcher here can make the page abort its own playback. */
            if(!pageMutationScriptletRuntimeOn())return!1;
            try{
              re.lastIndex=0;
              const matched=re.test(String(url||""));
              re.lastIndex=0;
              return matched
            }
            catch(_){
              return!1
            }

          })
        }
        catch(_){

        }

      },
      scSweepers=[];
      let scSweepObs=null,
      scSweepPending=!1;
      const scRunSweepers=()=>{
        if(!pageMutationScriptletRuntimeOn())return;
        for(const f of scSweepers)try{
          f()
        }
        catch(_){

        }

      },
      scAddSweeper=fn=>{
        if(scSweepers.push(fn),
        !scSweepObs)try{
          scSweepObs=new MutationObserver(()=>{
            scSweepPending||(scSweepPending=!0,
            setTimeout(()=>{
              scSweepPending=!1,
              scRunSweepers()
            },
            200))
          }),
          scSweepObs.observe(document.documentElement,
          {
            childList:!0,
            subtree:!0,
            attributes:!0
          })
        }
        catch(_){

        }
        try{
          fn()
        }
        catch(_){

        }

      },
      scWalkBudget={
        n:0
      },
      scWalkJson=(obj,
      parts,
      i,
      del)=>{
        if(null==obj||"object"!=typeof obj)return!1;
        if(--scWalkBudget.n<0)return!1;
        const key=parts[i],
        last=i===parts.length-1,
        keys="*"===key||"[]"===key?Object.keys(obj):[key];
        let found=!1;
        for(const k of keys)k in obj&&(last?(del&&delete obj[k],
        found=!0):scWalkJson(obj[k],
        parts,
        i+1,
        del)&&(found=!0));
        return found
      },
      scJsonPrune=(remove,
      required)=>{
        const rem=String(remove||"").split(/\s+/).filter(Boolean),
        req=String(required||"").split(/\s+/).filter(Boolean);
        if(!rem.length)return;
        if(adShieldVideoPlatform)return;
        const prune=obj=>{
          if(!pageMutationScriptletRuntimeOn())return obj;
          try{
            scWalkBudget.n=2e4;
            if(req.length&&!req.every(p=>scWalkJson(obj,
            p.split("."),
            0,
            !1)))return obj;
            rem.forEach(p=>scWalkJson(obj,
            p.split("."),
            0,
            !0))
          }
          catch(_){

          }
          return obj
        },
        realParse=JSON.parse;
        JSON.parse=function(){
          return prune(realParse.apply(this,
          arguments))
        };
        try{
          const realJson=Response.prototype.json;
          Response.prototype.json=function(){
            return realJson.apply(this,
            arguments).then(prune)
          }

        }
        catch(_){

        }

      },
      scNoWebRtc=()=>{
        const stub=function(){
          return{
            close(){

            },
            createDataChannel:()=>({

            }),
            createOffer:()=>Promise.reject(),
            createAnswer:()=>Promise.reject(),
            setLocalDescription(){

            },
            setRemoteDescription(){

            },
            addEventListener(){

            },
            addIceCandidate(){

            }

          }

        };
        ["RTCPeerConnection",
        "webkitRTCPeerConnection",
        "mozRTCPeerConnection"].forEach(n=>{
          try{
            const real=window[n];
            if("function"!=typeof real||real.__wardenOneScriptletRtc)return;
            const guarded=function(){
              if(pageMutationScriptletRuntimeOn())return stub();
              return Reflect.construct(real,
              Array.from(arguments),
              new.target||real)
            };
            guarded.prototype=real.prototype;
            try{
              Object.setPrototypeOf(guarded,
              real)
            }
            catch(_){

            }
            try{
              Object.defineProperty(guarded,
              "__wardenOneScriptletRtc",
              {
                value:!0
              })
            }
            catch(_){

            }
            window[n]=guarded
          }
          catch(_){

          }

        })
      },
      scMutatorBlocks={
        count:0
      },
      SCRIPTLET_LIB={
        "set-constant":a=>scSetConstant(a[0],
        scToken(a[1])),
        "abort-on-property-read":a=>scAbort(a[0],
        !1),
        "abort-on-property-write":a=>scAbort(a[0],
        !0),
        "abort-current-script":a=>scAbortCurrentScript(a[0],
        a[1]),
        "no-setTimeout-if":a=>scTimerDefuser("setTimeout",
        a[0],
        a[1]),
        "no-setInterval-if":a=>scTimerDefuser("setInterval",
        a[0],
        a[1]),
        "no-fetch-if":a=>scNoFetchIf(a[0]),
        "no-xhr-if":a=>scNoXhrIf(a[0]),
        "addEventListener-defuser":a=>scAeld(a[0],
        a[1]),
        "no-window-open-if":a=>scNoWindowOpen(a[0]),
        "remove-attr":a=>{
          const names=String(a[0]||"").split(/[|,\s]+/).filter(Boolean);
          if(!names.length)return;
          const sel=a[1]||names.map(n=>"["+n+"]").join(",");
          scAddSweeper(()=>{
            if(!pageMutationScriptletRuntimeOn())return;
            try{
              document.querySelectorAll(sel).forEach(el=>names.forEach(n=>{
                try{
                  el.removeAttribute(n)
                }
                catch(_){

                }

              }))
            }
            catch(_){

            }

          })
        },
        "remove-class":a=>{
          const cls=String(a[0]||"").split(/[|,\s]+/).filter(Boolean);
          if(!cls.length)return;
          const sel=a[1]||cls.map(c=>"."+c).join(",");
          scAddSweeper(()=>{
            if(!pageMutationScriptletRuntimeOn())return;
            try{
              document.querySelectorAll(sel).forEach(el=>cls.forEach(c=>{
                try{
                  el.classList.remove(c)
                }
                catch(_){

                }

              }))
            }
            catch(_){

            }

          })
        },
        "set-cookie":()=>{
          ++scMutatorBlocks.count<=10&&log("scriptlet_mutator_blocked",
          {
            name:"set-cookie"
          })
        },
        "set-local-storage-item":()=>{
          ++scMutatorBlocks.count<=10&&log("scriptlet_mutator_blocked",
          {
            name:"set-local-storage-item"
          })
        },
        "json-prune":a=>scJsonPrune(a[0],
        a[1]),
        nowebrtc:()=>scNoWebRtc()
      },
      runScriptlets=list=>{
        if(!WO.scriptletEngine)return;
        if(!Array.isArray(list)||!list.length)return;
        let n=0;
        for(const sc of list){
          if(!sc||!sc.name||!SCRIPTLET_LIB[sc.name])continue;
          if(scriptletPlayerPage())continue;
          const key=sc.name+"|"+(sc.args||[]).join("");
          if(!SCRIPTLET_RAN.has(key)){
            SCRIPTLET_RAN.add(key);
            try{
              SCRIPTLET_LIB[sc.name](sc.args||[]),
              n++
            }
            catch(_){

            }

          }

        }
        n&&log("scriptlet_injected",
        {
          count:n
        })
      },
      parseProcedural=raw=>{
        try{
          const ops=[],
          opRe=/:(-abp-contains|-abp-has|has-text|contains|has|matches-css(?:-before|-after)?|matches-attr|matches-path|min-text-length|upward|nth-ancestor|watch-attr|xpath|remove|style)\(/g;
          opRe.lastIndex=0;
          let mm=opRe.exec(raw);
          if(!mm)return null;
          const firstIdx=mm.index,
          base=raw.slice(0,
          firstIdx).trim()||"*";
          let idx=firstIdx;
          for(;
          idx<raw.length;
          ){
            opRe.lastIndex=idx;
            const m2=opRe.exec(raw);
            if(!m2||m2.index!==idx)break;
            const opName=m2[1];
            let p=opRe.lastIndex,
            depth=1,
            arg="";
            for(;
            p<raw.length&&depth>0;
            ){
              const ch=raw[p];
              if("("===ch)depth++;
              else if(")"===ch&&(depth--,
              0===depth))break;
              arg+=ch,
              p++
            }
            for(ops.push({
              op:opName,
              arg:arg.trim()
            }),
            idx=p+1;
            " "===raw[idx];
            )idx++
          }
          return ops.length?{
            base:base,
            ops:ops
          }
          :null
        }
        catch(_){
          return null
        }

      },
      textOf=el=>{
        try{
          return(el.textContent||"").trim()
        }
        catch{
          return""
        }

      },
      reOrText=(arg,
      hay)=>{
        if(arg.length>1&&"/"===arg[0]&&arg.lastIndexOf("/")>0){
          const last=arg.lastIndexOf("/");
          try{
            return new RegExp(arg.slice(1,
            last),
            arg.slice(last+1)).test(hay)
          }
          catch{
            return!1
          }

        }
        return hay.includes(arg.replace(/^["']|["']$/g,
        ""))
      },
      matchOp=(el,
      op,
      arg)=>{
        try{
          switch(op){
            case"has-text":case"contains":case"-abp-contains":return reOrText(arg,
            textOf(el));
            case"has":case"-abp-has":try{
              return!!el.querySelector(arg)
            }
            catch{
              return!1
            }
            case"matches-css":case"matches-css-before":case"matches-css-after":{
              const ci=arg.indexOf(":");
              if(-1===ci)return!1;
              const prop=arg.slice(0,
              ci).trim(),
              val=arg.slice(ci+1).trim(),
              actual=getComputedStyle(el,
              "matches-css-before"===op?"::before":"matches-css-after"===op?"::after":null).getPropertyValue(prop).trim();
              return reOrText(val,
              actual)||actual===val
            }
            case"matches-attr":{
              const eq=arg.indexOf("=");
              if(-1===eq)return el.hasAttribute(arg.replace(/["']/g,
              ""));
              const name=arg.slice(0,
              eq).replace(/["']/g,
              "").trim(),
              want=arg.slice(eq+1).replace(/["']/g,
              "").trim();
              return(el.getAttribute(name)||"").includes(want)
            }
            case"matches-path":return reOrText(arg,
            location.pathname+location.search);
            case"min-text-length":{
              const n=parseInt(arg,
              10);
              return isFinite(n)&&textOf(el).length>=n
            }
            default:return!1
          }

        }
        catch{
          return!1
        }

      },
      NON_MATCH_OPS=new Set(["upward",
      "nth-ancestor",
      "remove",
      "style",
      "xpath",
      "watch-attr",
      "others"]),
      resolveTarget=(el,
      ops)=>{
        let target=el;
        for(const{
          op:op,
          arg:arg
        }
        of ops)if("upward"===op||"nth-ancestor"===op)if(/^\d+$/.test(arg)){
          let n=parseInt(arg,
          10);
          for(;
          n-- >0&&target.parentElement;
          )target=target.parentElement
        }
        else try{
          const up=target.closest(arg);
          up&&(target=up)
        }
        catch(_){

        }
        return target
      },
      applyStyleDecls=(target,
      decls)=>{
        let did=!1;
        for(const d of String(decls).split(";")){
          const ci=d.indexOf(":");
          if(-1===ci)continue;
          const prop=d.slice(0,
          ci).trim();
          let val=d.slice(ci+1).trim(),
          prio="";
          if(/!important$/i.test(val)&&(prio="important",
          val=val.replace(/!important$/i,
          "").trim()),
          prop)try{
            target.style.setProperty(prop,
            val,
            prio),
            did=!0
          }
          catch(_){

          }

        }
        return did
      },
      applyAction=(target,
      ops)=>{
        if(!target)return!1;
        for(const{
          op:op,
          arg:arg
        }
        of ops){
          if("remove"===op)try{
            return target.remove(),
            !0
          }
          catch(_){
            return!1
          }
          if("style"===op)return applyStyleDecls(target,
          arg)
        }
        try{
          if(target.style&&"none"!==target.style.display)return target.style.setProperty("display",
          "none",
          "important"),
          !0
        }
        catch(_){

        }
        return!1
      },
      runProcedural=()=>{
        if(scriptletPlayerPage()||!procRules.length)return;
        let budget=PROC_BUDGET;
        for(const rule of procRules){
          if(budget<=0)break;
          const xpathOp=rule.ops.find(o=>"xpath"===o.op);
          if(xpathOp&&("*"!==rule.base||rule.ops.some(o=>!NON_MATCH_OPS.has(o.op))))continue;
          if(rule.ops.some(o=>"others"===o.op))continue;
          let candidates;
          if(xpathOp){
            candidates=[];
            try{
              const r=document.evaluate(xpathOp.arg,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null);
              for(let i=0;
              i<r.snapshotLength;
              i++){
                const n=r.snapshotItem(i);
                n&&1===n.nodeType&&candidates.push(n)
              }

            }
            catch{
              continue
            }

          }
          else try{
            candidates=document.querySelectorAll(rule.base)
          }
          catch{
            continue
          }
          for(const el of candidates){
            if(budget<=0)break;
            let ok=!0;
            for(const{
              op:op,
              arg:arg
            }
            of rule.ops)if(!NON_MATCH_OPS.has(op)&&!matchOp(el,
            op,
            arg)){
              ok=!1;
              break
            }
            ok&&applyAction(resolveTarget(el,
            rule.ops),
            rule.ops)&&budget--
          }

        }

      },
      requestAndApply=()=>{
        try{
          if(!allowGoogleSearchCosmetics()){
            log("adshield_skipped",
            {
              why:"google-search-cleanup-off"
            });
            return
          }
          if(adShieldVideoPlatform){
            injectCss(SAFE_VIDEO_AD_SELECTORS),
            collapseLeftovers(document),
            log("adshield_video_safe_mode",
            {

            });
            try{
              let collapsePending=!1;
              woObserve(()=>{
                if(styleEl&&!styleEl.isConnected)try{
                  (document.head||document.documentElement).appendChild(styleEl)
                }
                catch(_){

                }
                collapsePending||(collapsePending=!0,
                setTimeout(()=>{
                  collapsePending=!1;
                  try{
                    collapseLeftovers(document)
                  }
                  catch(_){

                  }

                },
                250))
              })
            }
            catch(_){

            }

          }
          __woBackgroundRequest({
            kind:"adshield-cosmetic",
            hostname:host,
            playerPage:scriptletPlayerPage()
          },
          res=>{
            try{
              if(!res||!res.ok)return;
              if(res.allowlisted||res.disabled)return styleEl&&(styleEl.textContent=""),
              void log("adshield_skipped",
              {
                why:res.allowlisted?"allowlisted":"disabled"
              });
              if(scriptletPlayerPage()){
                adShieldVideoPlatform?injectCss(SAFE_VIDEO_AD_SELECTORS):styleEl&&(styleEl.textContent=""),
                procRules=[],
                collapseLeftovers(document),
                log("adshield_player_safe_mode",
                {

                });
                return
              }
              injectCss(adShieldVideoPlatform?SAFE_VIDEO_AD_SELECTORS.concat(res.selectors||[]):res.selectors||[]),
              collapseLeftovers(document);
              try{
                Array.isArray(res.procedural)&&res.procedural.length&&(procRules=res.procedural.map(parseProcedural).filter(Boolean),
                runProcedural())
              }
              catch(_){

              }
              try{
                runScriptlets(res.scriptlets)
              }
              catch(_){

              }
              try{
                let procPending=!1,
                collapsePending=!1;
                woObserve(()=>{
                  if(scriptletPlayerPage()){
                    adShieldVideoPlatform?injectCss(SAFE_VIDEO_AD_SELECTORS):styleEl&&(styleEl.textContent=""),
                    procRules=[],
                    collapseLeftovers(document);
                    return
                  }
                  if(styleEl&&!styleEl.isConnected)try{
                    (document.head||document.documentElement).appendChild(styleEl)
                  }
                  catch(_){

                  }
                  collapsePending||(collapsePending=!0,
                  setTimeout(()=>{
                    collapsePending=!1;
                    try{
                      collapseLeftovers(document)
                    }
                    catch(_){

                    }

                  },
                  250)),
                  procRules.length&&!procPending&&(procPending=!0,
                  setTimeout(()=>{
                    procPending=!1;
                    try{
                      runProcedural()
                    }
                    catch(_){

                    }

                  },
                  500))
                })
              }
              catch(_){

              }

            }
            catch(_){

            }

          })
        }
        catch(_){

        }

      };
      let adshieldCosmeticsStarted=!1;
      const maybeStartAdshieldCosmetics=()=>{
        if(adshieldCosmeticsStarted||!allowGoogleSearchCosmetics())return;
        adshieldCosmeticsStarted=!0,
        document.documentElement?requestAndApply():document.addEventListener("DOMContentLoaded",
        requestAndApply,
        {
          once:!0
        })
      };
      maybeStartAdshieldCosmetics()
    }
    catch(e){
      log("adshield_failed",
      {
        error:String(e)
      })
    }
    if(isGoogleSearchResults()||isBraveSearchResults())try{
      const GOOGLE_CLEANUP_SELECTORS=["#tads",
      "#tadsb",
      "#bottomads",
      "#taw",
      "#tvcap",
      ".commercial-unit-desktop-top",
      ".commercial-unit-desktop-rhs",
      ".commercial-unit-mobile-top",
      ".pla-unit",
      ".uEierd",
      "[data-text-ad]",
      "[data-pla]",
      "[data-google-query-id]",
      "div[aria-label='Ads']",
      "div[aria-label='Sponsored']"],
      BRAVE_SPONSORED_SELECTORS=["[data-testid='ad']",
      "[data-testid='ad-result']",
      "[data-testid='sponsored-result']",
      ".ad-result",
      ".sponsored-result"],
      BRAVE_AI_SELECTORS=["#llm-answer",
      ".llm-answer",
      "[data-testid='llm-answer']",
      "[data-testid='ai-answer']",
      "[data-testid='answer-with-ai']"],
      GOOGLE_PAA_SEL=".related-question-pair",
      GOOGLE_AI_TARGET_SEL="#m-x-content",
      GOOGLE_CLEANUP_TARGET_SEL=GOOGLE_AI_TARGET_SEL+",[data-wo-google-search-cleaned]",
      GOOGLE_AI_SHELL_SEL=":is(.MjjYud,div[data-hveid],div[jscontroller],div[jsname],g-section-with-header,section,aside):has("+GOOGLE_AI_TARGET_SEL+"):not(:has(#rso,#search,#res,#center_col,"+GOOGLE_PAA_SEL+"))",
      SEARCH_IS_GOOGLE="function"==typeof isGoogleSearchResults&&isGoogleSearchResults(),
      SEARCH_IS_BRAVE="function"==typeof isBraveSearchResults&&isBraveSearchResults(),
      SEARCH_AI_ON=!!(WO.blockSearchAiAnswers||WO.googleSearchResultCleanup),
      SEARCH_ADS_ON=!!(WO.blockSponsoredSearchResults||WO.googleSearchResultCleanup),
      searchSponsoredSelectors=()=>SEARCH_IS_BRAVE?BRAVE_SPONSORED_SELECTORS:GOOGLE_CLEANUP_SELECTORS,
      searchAiSelectors=()=>SEARCH_IS_BRAVE?BRAVE_AI_SELECTORS:GOOGLE_AI_TARGET_SEL.split(","),
      searchCleanupSelectors=()=>SEARCH_ADS_ON?searchSponsoredSelectors():[],
      inPaa=el=>{
        try{
          if(!el)return!1;
          if(el.closest&&el.closest(GOOGLE_PAA_SEL))return!0;
          for(let n=el,
          i=0;
          n&&n!==document.body&&n!==document.documentElement&&i<12;
          n=n.parentElement,
          i++){
            if(/^(rso|search|res|center_col|rcnt|appbar|main|cnt|top)$/i.test(n.id||""))break;
            const h=n.querySelector&&n.querySelector("[role='heading'],h2,h3");
            if(h&&/^People also ask$/i.test(String(h.textContent||"").replace(/\s+/g,
            " ").trim()))return!0
          }
          return!1
        }
        catch(_){
          return!1
        }

      },
      containsResults=el=>{
        try{
          return!!(el&&el.querySelector&&(el.querySelector("#rso,#search,#res,#center_col")||el.querySelectorAll(".MjjYud").length>=5))
        }
        catch(_){
          return!1
        }

      },
      googleHasCleanupTarget=el=>{
        try{
          if(!el)return!1;
          const selectors=["[data-wo-google-search-cleaned]"];
          SEARCH_AI_ON&&selectors.push(...searchAiSelectors());
          SEARCH_ADS_ON&&selectors.push(...searchSponsoredSelectors());
          const sel=selectors.join(",");
          return!!((el.matches&&el.matches(sel))||(el.querySelector&&el.querySelector(sel)))
        }
        catch(_){
          return!1
        }

      },
      googleLooksLikeResult=el=>{
        try{
          if(!el||!el.querySelector||googleHasCleanupTarget(el))return!1;
          if(containsResults(el)||el.querySelector(GOOGLE_PAA_SEL))return!0;
          const text=googleCleanText(el);
          if(text.length<8)return!1;
          const marker=((el.id||"")+" "+(el.className||"")).toString();
          if(/\bMjjYud\b/.test(marker))return!0;
          if(el.querySelector("h3,[role='heading']")&&text.length>8)return!0;
          if(el.querySelector("a[href]")&&text.length>20)return!0;
          return!1
        }
        catch(_){
          return!1
        }

      },
      googleHasIndependentResult=el=>{
        try{
          if(!el||!el.children)return!1;
          for(const c of el.children){
            const r=c.getBoundingClientRect?c.getBoundingClientRect():null;
            if(r&&r.height>2&&r.width>2&&!googleHasCleanupTarget(c)&&googleLooksLikeResult(c))return!0
          }
          return!1
        }
        catch(_){
          return!1
        }

      },
      googleIsOrphanControl=el=>{
        try{
          return/^(Show more|Show all|Learn more)\b/i.test(googleCleanText(el).slice(0,
          80))
        }
        catch(_){
          return!1
        }

      },
      googleIsShellChrome=el=>{
        try{
          const text=googleCleanText(el);
          if(!text)return!0;
          if(googleIsOrphanControl(el))return!0;
          if(text.length<160&&!(el.querySelector&&el.querySelector("a[href],h3,[role='heading']")))return!0;
          return!1
        }
        catch(_){
          return!1
        }

      },
      collapseShell=el=>{
        try{
          let n=el&&el.parentElement;
          for(let i=0;
          n&&n!==document.body&&n!==document.documentElement&&i<5;
          n=n.parentElement,
          i++){
            if(/^(rso|search|res|center_col|rcnt|appbar|main|cnt|top)$/i.test(n.id||""))break;
            if(containsResults(n))break;
            let hasVisible=!1;
            for(const c of n.children){
              const r=c.getBoundingClientRect?c.getBoundingClientRect():null;
              if(r&&r.height>2&&r.width>2){
                if(googleIsOrphanControl(c)){
                  googleHide(c);
                  continue
                }
                if(googleHasIndependentResult(c)){
                  hasVisible=!0;
                  break
                }
                if(googleHasCleanupTarget(c)||googleIsShellChrome(c)){
                  googleHide(c);
                  continue
                }
                if(!googleLooksLikeResult(c)){
                  googleHide(c);
                  continue
                }
                hasVisible=!0;
                break
              }

            }
            if(hasVisible)break;
            const rr=n.getBoundingClientRect?n.getBoundingClientRect():null;
            if(!rr||rr.height<8)continue;
            n.style.setProperty("min-height",
            "0",
            "important"),
            n.style.setProperty("height",
            "0",
            "important"),
            n.style.setProperty("margin",
            "0",
            "important"),
            n.style.setProperty("padding",
            "0",
            "important"),
            n.style.setProperty("overflow",
            "hidden",
            "important"),
            n.setAttribute("data-wo-google-search-collapsed",
            "1")
          }

        }
        catch(_){

        }

      },
      installGoogleCleanupCss=()=>{
        try{
          if(document.getElementById("rg-google-search-cleanup-css"))return;
          const selectors=[];
          SEARCH_ADS_ON&&selectors.push(...searchSponsoredSelectors());
          if(SEARCH_AI_ON){
            SEARCH_IS_BRAVE?selectors.push(...BRAVE_AI_SELECTORS):(selectors.push(GOOGLE_AI_SHELL_SEL),
            selectors.push(":is("+GOOGLE_AI_TARGET_SEL+"):not(:has(#rso,#search,#res,#center_col))"))
          }
          if(!selectors.length)return;
          const s=document.createElement("style");
          s.id="rg-google-search-cleanup-css",
          s.textContent=selectors.join(",")+"{display:none!important;visibility:hidden!important;pointer-events:none!important;}"+(SEARCH_IS_GOOGLE?":is(html,#rso,#search,#res,#center_col) .related-question-pair :is("+GOOGLE_AI_TARGET_SEL+",div[aria-label='Sponsored'],div[aria-label='Ads']){display:block!important;visibility:visible!important;pointer-events:auto!important;}":"");
          (document.head||document.documentElement).appendChild(s)
        }
        catch(_){

        }

      },
      googleCleanupSeen=new WeakSet,
      googleCleanText=el=>{
        try{
          return String(el&&el.textContent||"").replace(/\s+/g,
          " ").trim()
        }
        catch(_){
          return""
        }

      },
      searchSponsoredDestinations=new Set,
      searchBaseUrl=()=>{
        try{
          return location.href||location.origin||"https://"+location.hostname+"/"
        }
        catch(_){
          return"https://example.invalid/"
        }

      },
      searchCleanHost=h=>String(h||"").toLowerCase().replace(/^www\d*\./,
      ""),
      searchHostKeys=url=>{
        const out=[];
        try{
          const u=new URL(String(url||""),
          searchBaseUrl()),
          h=searchCleanHost(u.hostname);
          if(!h)return out;
          out.push(h);
          try{
            if("function"==typeof regDomain){
              const rd=searchCleanHost(regDomain(h));
              rd&&rd!==h&&out.push(rd)
            }

          }
          catch(_){

          }
        }
        catch(_){

        }
        return Array.from(new Set(out))
      },
      searchIgnoredSponsorHost=h=>{
        h=searchCleanHost(h);
        return!h||/(^|\.)google(?:adservices|apis|usercontent|syndication)?\./i.test(h)||/(^|\.)gstatic\./i.test(h)||/(^|\.)doubleclick\.net$/i.test(h)||"search.brave.com"===h||"brave.com"===h
      },
      searchIsAdClickUrl=url=>{
        try{
          const u=new URL(String(url||""),
          searchBaseUrl()),
          h=searchCleanHost(u.hostname),
          p=u.pathname||"";
          return/(^|\.)googleadservices\.com$/i.test(h)||/(^|\.)googlesyndication\.com$/i.test(h)||/(^|\.)doubleclick\.net$/i.test(h)||/(^|\.)google\.[a-z.]+$/i.test(h)&&/^\/(?:aclk|pagead\/aclk|ads\/|afs\/ads)/i.test(p)||"search.brave.com"===h&&/^\/(?:ad|ads|click|a)\b/i.test(p)
        }
        catch(_){
          return!1
        }

      },
      searchUnwrapSponsoredUrl=url=>{
        try{
          const u=new URL(String(url||""),
          searchBaseUrl());
          if(!searchIsAdClickUrl(u.href))return u.href;
          for(const key of["adurl",
          "url",
          "q",
          "u",
          "target",
          "dest",
          "destination"]){
            const v=u.searchParams.get(key);
            if(/^https?:\/\//i.test(String(v||"")))return v
          }
          return u.href
        }
        catch(_){
          return String(url||"")
        }

      },
      searchRememberSponsoredLinks=root=>{
        try{
          if(!SEARCH_ADS_ON||!root||!root.querySelectorAll)return;
          root.setAttribute&&root.setAttribute("data-wo-sponsored-search-result",
          "1");
          root.querySelectorAll("a[href],area[href]").forEach(a=>{
            const raw=a.getAttribute&&a.getAttribute("href")||a.href||"",
            unwrapped=searchUnwrapSponsoredUrl(raw);
            searchHostKeys(unwrapped).forEach(h=>{
              !searchIgnoredSponsorHost(h)&&searchSponsoredDestinations.add(h)
            })
          })
        }
        catch(_){

        }

      },
      searchIsSponsoredUrl=url=>{
        try{
          if(!SEARCH_ADS_ON||!url)return!1;
          if(searchIsAdClickUrl(url))return!0;
          const unwrapped=searchUnwrapSponsoredUrl(url);
          if(searchIsAdClickUrl(unwrapped))return!0;
          return searchHostKeys(unwrapped).some(h=>searchSponsoredDestinations.has(h))
        }
        catch(_){
          return!1
        }

      },
      searchInSponsoredModule=el=>{
        try{
          for(let n=el,
          i=0;
          n&&n!==document.body&&n!==document.documentElement&&i<8;
          n=n.parentElement,
          i++){
            if(n.getAttribute&&"1"===n.getAttribute("data-wo-sponsored-search-result"))return!0;
            if(n.matches&&SEARCH_ADS_ON&&n.matches(searchSponsoredSelectors().join(",")))return!0;
            if(/^(rso|search|res|center_col|rcnt|appbar|main|cnt|top)$/i.test(n.id||""))break
          }
        }
        catch(_){

        }
        return!1
      },
      searchSponsoredClickBlockerState={
        installed:!1
      },
      installSponsoredClickBlocker=()=>{
        try{
          if(searchSponsoredClickBlockerState.installed||!SEARCH_ADS_ON||!document.addEventListener)return;
          searchSponsoredClickBlockerState.installed=!0;
          const block=e=>{
            try{
              const start=e&&e.target&&1===e.target.nodeType?e.target:e&&e.target&&e.target.parentElement;
              if(!start)return;
              const a=start.closest&&start.closest("a[href],area[href]");
              const href=a&&(a.getAttribute&&a.getAttribute("href")||a.href)||"";
              if(!searchInSponsoredModule(start)&&!searchIsSponsoredUrl(href))return;
              e.preventDefault&&e.preventDefault(),
              e.stopPropagation&&e.stopPropagation(),
              e.stopImmediatePropagation&&e.stopImmediatePropagation(),
              log("blocked_sponsored_search_click",
              {
                host:searchHostKeys(searchUnwrapSponsoredUrl(href))[0]||"",
                reason:searchInSponsoredModule(start)?"sponsored_result":"sponsored_site"
              })
            }
            catch(_){

            }

          };
          document.addEventListener("click",
          block,
          !0),
          document.addEventListener("auxclick",
          block,
          !0)
        }
        catch(_){

        }

      },
      googleHide=el=>{
        try{
          if(!el||googleCleanupSeen.has(el)||el===document.body||el===document.documentElement)return!1;
          googleCleanupSeen.add(el),
          el.style.setProperty("display",
          "none",
          "important"),
          el.style.setProperty("visibility",
          "hidden",
          "important"),
          el.setAttribute("data-wo-google-search-cleaned",
          "1");
          return!0
        }
        catch(_){
          return!1
        }

      },
      googleModuleFor=(el,
      kind)=>{
        let best=null;
        try{
          for(let n=el,
          i=0;
          n&&n!==document.body&&n!==document.documentElement&&i<12;
          n=n.parentElement,
          i++){
            if(/^(rso|search|res|center_col|rcnt|appbar|main|cnt|top)$/i.test(n.id||""))break;
            if(n.querySelector&&n.querySelector(GOOGLE_PAA_SEL))break;
            if(containsResults(n))break;
            const r=n.getBoundingClientRect&&n.getBoundingClientRect();
            if(!r||r.width<180||r.height<18||r.width>innerWidth*.96||("ai"===kind?r.height>3*innerHeight:r.height>innerHeight*.9))continue;
            if(googleHasIndependentResult(n))break;
            const text=googleCleanText(n).slice(0,
            4000),
            marker=((n.id||"")+" "+(n.className||"")+" "+(n.getAttribute&&n.getAttribute("role")||"")+" "+(n.getAttribute&&n.getAttribute("aria-label")||"")).toString(),
            structural=/\b(MjjYud|SoaBEf|ULSxyf|uEierd|commercial|pla-unit|mnr-c|llm-answer|ai-answer|ad-result|sponsored-result)\b/i.test(marker)||n.matches&&n.matches("div[data-hveid],div[jscontroller],div[jsname],g-section-with-header,section,aside,article,[role='complementary'],[data-testid='llm-answer'],[data-testid='ai-answer'],[data-testid='ad'],[data-testid='ad-result']");
            if(/\bPeople also ask\b/i.test(text))break;
            if("ai"===kind&&(/\bAI Overview\b/i.test(text)||SEARCH_IS_BRAVE&&/\b(Answer with AI|AI answer|Brave AI|Brave Leo|Summarizer)\b/i.test(text)))best=n;
            if("ad"===kind&&(/\bSponsored\b/i.test(text)||/\bAds?\b/i.test(text))&&(structural||r.height>50))best=n;
            if(best&&(n.parentElement&&/^(rso|search|rhs|center_col)$/i.test(n.parentElement.id||"")))break
          }

        }
        catch(_){

        }
        return best||el
      },
      googleCleanupSweep=root=>{
        let hidden=0;
        try{
          installGoogleCleanupCss();
          installSponsoredClickBlocker();
          const directSelectors=[],
          sponsoredSel=SEARCH_ADS_ON?searchSponsoredSelectors().join(","):"";
          SEARCH_ADS_ON&&directSelectors.push(...searchSponsoredSelectors());
          SEARCH_AI_ON&&directSelectors.push(...searchAiSelectors());
          directSelectors.length&&(root||document).querySelectorAll(directSelectors.join(",")).forEach(el=>{
            if(inPaa(el)||containsResults(el))return;
            sponsoredSel&&el.matches&&el.matches(sponsoredSel)&&searchRememberSponsoredLinks(el);
            googleHide(el)&&hidden++;
            collapseShell(el)
          });
          (root||document).querySelectorAll("span,div,h2,h3,section,aside,[aria-label]").forEach(el=>{
            if(hidden>24)return;
            const label=(el.getAttribute&&el.getAttribute("aria-label")||googleCleanText(el)).replace(/\s+/g,
            " ").trim(),
            isAi=SEARCH_AI_ON&&(/^(Search Labs )?AI Overview$/i.test(label)||SEARCH_IS_BRAVE&&/^(Answer with AI|AI answer|Brave AI|Brave Leo|Summarizer)$/i.test(label)),
            isAd=SEARCH_ADS_ON&&!isAi&&/^(Sponsored|Ads?|Advertisement)$/i.test(label);
            if(!isAi&&!isAd)return;
            if(inPaa(el))return;
            const lr=el.getBoundingClientRect&&el.getBoundingClientRect(),
            labelVisible=!!lr&&lr.width>=8&&lr.height>=8,
            hiddenByUs=!!(el.closest&&el.closest("#m-x-content,.uEierd,[data-google-query-id],[data-wo-google-search-cleaned]"));
            if(!labelVisible&&!hiddenByUs)return;
            const mod=googleModuleFor(el,
            isAi?"ai":"ad");
            isAd&&searchRememberSponsoredLinks(mod);
            googleHide(mod)&&hidden++;
            collapseShell(mod)
          })
        }
        catch(_){

        }
        hidden&&log("google_search_cleanup",
        {
          hidden:hidden
        })
      };
      const startGoogleCleanup=()=>{
        googleCleanupSweep(document);
        let pending=!1,
        runs=0;
        try{
          woObserve(muts=>{
            if(runs>80)return;
            let useful=!1;
            for(const m of muts){
              if(m&&m.addedNodes&&m.addedNodes.length){
                useful=!0;
                break
              }

            }
            useful&&!pending&&(pending=!0,
            setTimeout(()=>{
              pending=!1,
              runs++,
              googleCleanupSweep(document)
            },
            250))
          })
        }
        catch(_){

        }
        setTimeout(()=>googleCleanupSweep(document),
        800),
        setTimeout(()=>googleCleanupSweep(document),
        1800)
      };
      let googleCleanupStarted=!1;
      const maybeStartGoogleCleanup=()=>{
        if(googleCleanupStarted||!SEARCH_AI_ON&&!SEARCH_ADS_ON)return;
        googleCleanupStarted=!0,
        document.documentElement?startGoogleCleanup():document.addEventListener("DOMContentLoaded",
        startGoogleCleanup,
        {
          once:!0
        })
      };
      maybeStartGoogleCleanup(),
      document.addEventListener("wo-config-change",
      maybeStartGoogleCleanup)
    }
    catch(e){
      log("google_search_cleanup_failed",
      {
        error:String(e)
      })
    }
    if(WO.scriptletEngine||WO.twitchAdBlock)try{
      const host=location.hostname;
      if(!1&&WO.twitchAdBlock&&/(^|\.)twitch\.tv$/i.test(location.hostname)&&"undefined"!=typeof Worker)try{
        const installTwitchHook=function(){
          const AD_RE=/stitched|twitch-ad-quartile|x-tv-twitch-ad/i,
          realFetch=self.fetch.bind(self),
          media=new Map,
          backups=new Map,
          MEDIA_TTL=3e5,
          MEDIA_MAX=96,
          BACKUP_TTL=6e4,
          BACKUP_MAX=8,
          pruneCache=(map,
          max,
          ttl)=>{
            const now=Date.now();
            try{
              for(const [k,
              v]of map){
                v&&v.ts&&now-v.ts>ttl&&map.delete(k)
              }
              while(map.size>max){
                const k=map.keys().next().value;
                if(void 0===k)break;
                map.delete(k)
              }

            }
            catch(_){

            }

          },
          rememberMedia=(url,
          entry)=>{
            if(!url)return;
            entry.ts=Date.now(),
            media.set(url,
            entry),
            media.set(url.split("?")[0],
            entry),
            pruneCache(media,
            MEDIA_MAX,
            MEDIA_TTL)
          },
          rememberBackup=(channel,
          vars)=>{
            if(!channel||!vars||!vars.length)return;
            backups.set(channel,
            {
              vars:vars,
              ts:Date.now()
            }),
            pruneCache(backups,
            BACKUP_MAX,
            BACKUP_TTL)
          },
          parseAttrs=line=>{
            const out={

            };
            return(line.match(/[A-Z0-9-]+=(?:"[^"]*"|[^,]*)/g)||[]).forEach(kv=>{
              const i=kv.indexOf("=");
              out[kv.slice(0,
              i)]=kv.slice(i+1).replace(/^"|"$/g,
              "")
            }),
            out
          },
          parseMaster=text=>{
            const lines=text.split("\n"),
            vars=[],
            vmap={

            };
            for(let i=0;
            i<lines.length;
            i++)if(0===lines[i].indexOf("#EXT-X-MEDIA:")&&/TYPE=VIDEO/i.test(lines[i])){
              const a=parseAttrs(lines[i]);
              a["GROUP-ID"]&&(vmap[a["GROUP-ID"]]=a.NAME||"")
            }
            for(let i=0;
            i<lines.length;
            i++)if(0===lines[i].indexOf("#EXT-X-STREAM-INF:")){
              const a=parseAttrs(lines[i]),
              u=(lines[i+1]||"").trim(),
              vid=a.VIDEO||"";
              u&&"#"!==u[0]&&vars.push({
                url:u,
                res:a.RESOLUTION||"",
                fps:Math.round(parseFloat(a["FRAME-RATE"]||"0")||0),
                video:vid,
                name:vid&&vmap.hasOwnProperty(vid)?vmap[vid]:"",
                codecs:a.CODECS||""
              })
            }
            return vars
          },
          qArea=r=>{
            const m=/(\d+)x(\d+)/.exec(r||"");
            return m?+m[1]*+m[2]:0
          },
          pickVar=(vars,
          info)=>{
            var __cf=function(c){
              c=(c||"").toLowerCase();
              return c.indexOf("av01")>=0?"av1":c.indexOf("hvc1")>=0||c.indexOf("hev1")>=0?"hevc":c.indexOf("avc1")>=0?"h264":""
            },
            __f=__cf(info&&info.codecs),
            pool=__f?vars.filter(function(v){
              return __cf(v.codecs)===__f
            }):vars;
            if(!pool.length)pool=vars;
            return info.video&&pool.find(v=>v.video===info.video)||info.name&&pool.find(v=>v.name===info.name)||pool.find(v=>v.res===info.res&&(!info.fps||v.fps===info.fps))||pool.find(v=>v.res===info.res)||(info.res&&pool.filter(v=>v.res).reduce((b,
            v)=>b&&Math.abs(qArea(b.res)-qArea(info.res))<=Math.abs(qArea(v.res)-qArea(info.res))?b:v,
            null))||pool[0]
          },
          backupMediaUrl=async info=>{
            const TTL=2e4,
            hit=backups.get(info.channel);
            pruneCache(backups,
            BACKUP_MAX,
            BACKUP_TTL);
            if(hit&&hit.vars&&hit.vars.length&&Date.now()-hit.ts<TTL){
              const pk=pickVar(hit.vars,
              info);
              if(pk)return pk.url
            }
            const BACKUP_PLAYER_TYPES=["embed",
            "popout",
            "autoplay"],
            token=async(channel,
            playerType)=>{
              const plat="autoplay"===playerType?"android":"web",
              r=await realFetch("https://gql.twitch.tv/gql",
              {
                method:"POST",
                headers:{
                  "Client-ID":"kimne78kx3ncx6brgo4mv6wki5h1ko"
                },
                body:JSON.stringify({
                  operationName:"PlaybackAccessToken_Template",
                  query:'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "'+plat+'", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature    authorization { isForbidden forbiddenReasonCode }    __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "'+plat+'", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}',
                  variables:{
                    isLive:!0,
                    login:channel,
                    isVod:!1,
                    vodID:"",
                    playerType:playerType
                  }

                })
              }),
              j=await r.json(),
              t=j&&j.data&&j.data.streamPlaybackAccessToken;
              if(!t||!t.value||!t.signature)throw new Error("no backup token");
              if(t.authorization&&t.authorization.isForbidden)throw new Error("forbidden backup token");
              return t
            };
            let lastErr=null,
            fb=null,
            fbVars=null;
            const __woAtt=async pt=>{
              const t=await token(info.channel,
              pt),
              u=new URL(info.master);
              u.searchParams.set("sig",
              t.signature),
              u.searchParams.set("token",
              t.value);
              const r=await realFetch(u.href);
              if(!r.ok)throw new Error("backup master http "+r.status);
              const vars=parseMaster(await r.text());
              if(!vars.length)throw new Error("backup master empty");
              const pick=pickVar(vars,
              info);
              let mtext="";
              try{
                const mr=await realFetch(pick.url);
                if(mr.ok)mtext=await mr.text()
              }
              catch(_){

              }
              return{
                pick:pick,
                vars:vars,
                clean:!(!mtext||-1===mtext.indexOf("#EXTINF")||AD_RE.test(mtext))
              }

            };
            const __woJobs=BACKUP_PLAYER_TYPES.map(pt=>__woAtt(pt).then(r=>r,
            e=>({
              __e:e
            })));
            for(const __j of __woJobs){
              const v=await __j;
              if(v&&v.__e){
                lastErr=v.__e;
                continue
              }
              if(v&&v.clean)return rememberBackup(info.channel,
              v.vars),
              v.pick.url;
              v&&!fb&&(fb=v.pick.url,
              fbVars=v.vars)
            }
            if(fb)return fbVars&&rememberBackup(info.channel,
            fbVars),
            fb;
            throw lastErr||new Error("no backup stream")
          },
          m3u8=text=>new Response(text,
          {
            status:200,
            headers:{
              "Content-Type":"application/vnd.apple.mpegurl"
            }

          });
          self.fetch=async function(input,
          init){
            let url="";
            try{
              url="string"==typeof input?input:String(input&&input.url||input)
            }
            catch(_){

            }
            if(-1===url.indexOf(".m3u8"))return realFetch(input,
            init);
            if(/usher\.ttvnw\.net|\/api\/channel\/hls\//i.test(url)){
              let _in=input;
              if("string"==typeof input)try{
                var _u=new URL(input);
                if(_u.searchParams.has("parent_domains")){
                  _u.searchParams.delete("parent_domains");
                  _in=_u.href
                }

              }
              catch(_){

              }
              let res=await realFetch(_in,
              init);
              if(!res.ok&&_in!==input){
                try{
                  res=await realFetch(input,
                  init)
                }
                catch(_){

                }

              }
              try{
                const text=await res.clone().text(),
                channel=(url=>{
                  const m=/\/hls\/([^./?]+)\.m3u8/i.exec(url);
                  return m?decodeURIComponent(m[1]).toLowerCase():""
                })(url);
                channel&&parseMaster(text).forEach(v=>{
                  const entry={
                    channel:channel,
                    res:v.res,
                    fps:v.fps,
                    video:v.video,
                    name:v.name,
                    master:url,
                    codecs:v.codecs
                  };
                  rememberMedia(v.url,
                  entry)
                })
              }
              catch(_){

              }
              return res
            }
            const res=await realFetch(input,
            init);
            let text="";
            try{
              text=await res.clone().text()
            }
            catch(_){
              return res
            }
            if(!AD_RE.test(text))return res;
            pruneCache(media,
            MEDIA_MAX,
            MEDIA_TTL);
            const info=media.get(url)||media.get(url.split("?")[0]);
            try{
              if(!info)throw new Error("unmapped stream");
              const bText=await Promise.race([(async()=>{
                let bUrl=await backupMediaUrl(info),
                bRes=await realFetch(bUrl);
                if(!bRes.ok&&(backups.delete(info.channel),
                bUrl=await backupMediaUrl(info),
                bRes=await realFetch(bUrl),
                !bRes.ok))throw new Error("backup http "+bRes.status);
                const t=await bRes.text();
                if(AD_RE.test(t)||-1===t.indexOf("#EXTINF"))throw new Error("backup unusable");
                return t
              })(),
              new Promise((_,
              r)=>setTimeout(()=>r(new Error("wo backup timeout")),
              5e3))]);
              return m3u8(bText)
            }
            catch(_){
              try{
                info&&info.channel&&backups.delete(info.channel)
              }
              catch(__){

              }
              return res
            }

          }

        },
        hookSrc="("+installTwitchHook.toString()+")();\n",
        RealWorker=window.Worker;
        const twitchWorker=function(scriptURL,
        options){
          try{
            const live=!0,
            isModule=options&&"module"===options.type;
            if(live){
              const s=String(scriptURL),
              workerUrl=new URL(s,
              location.href).href,
              tail=isModule?"import "+JSON.stringify(workerUrl)+";":"importScripts("+JSON.stringify(workerUrl)+");",
              wrapped=URL.createObjectURL(new Blob([hookSrc,
              tail],
              {
                type:isModule?"text/javascript":"application/javascript"
              })),
              worker=new RealWorker(wrapped,
              options);
              try{
                setTimeout(function(){
                  try{
                    URL.revokeObjectURL(wrapped)
                  }
                  catch(_){

                  }

                },
                15e3)
              }
              catch(_){

              }
              return worker
            }

          }
          catch(_){

          }
          return new RealWorker(scriptURL,
          options)
        };
        twitchWorker.prototype=RealWorker.prototype,
        window.Worker.__woTw||(twitchWorker.__woTw=!0,
        window.Worker=twitchWorker),
        log("scriptlet_twitch_adblock",
        {

        });
        try{
          var __woRealFetch=window.fetch;
          if("function"==typeof __woRealFetch&&!__woRealFetch.__woTwForced){
            var __woForcedFetch=function(input,
            init){
              try{
                if(init&&"string"==typeof init.body&&init.body.indexOf("PlaybackAccessToken")>=0){
                  var b=JSON.parse(init.body),
                  arr=Array.isArray(b)?b:[b];
                  if(arr.length&&arr.every(function(o){
                    return o&&o.variables&&"picture-by-picture"===o.variables.playerType
                  }))return __woRealFetch.call(window,
                  input,
                  Object.assign({

                  },
                  init,
                  {
                    body:""
                  }));
                  var ch=!1;
                  for(var i=0;
                  i<arr.length;
                  i++){
                    var op=arr[i];
                    op&&op.variables&&op.variables.isLive&&/PlaybackAccessToken/.test(op.operationName||"")&&"popout"!==op.variables.playerType&&(op.variables.playerType="popout",
                    ch=!0)
                  }
                  ch&&(init=Object.assign({

                  },
                  init,
                  {
                    body:JSON.stringify(b)
                  }))
                }

              }
              catch(_){

              }
              return __woRealFetch.call(window,
              input,
              init)
            };
            try{
              __woForcedFetch.__woTwForced=!0
            }
            catch(_){

            }
            window.fetch=__woForcedFetch;
            ;
            /*__woTwReassert*/(function(){
              function mk(p){
                var w=function(input,
                init){
                  try{
                    if(init&&"string"==typeof init.body&&init.body.indexOf("PlaybackAccessToken")>=0){
                      var b=JSON.parse(init.body),
                      arr=Array.isArray(b)?b:[b];
                      if(arr.length&&arr.every(function(o){
                        return o&&o.variables&&"picture-by-picture"===o.variables.playerType
                      }))return p.call(this,
                      input,
                      Object.assign({

                      },
                      init,
                      {
                        body:""
                      }));
                      var ch=!1;
                      for(var i=0;
                      i<arr.length;
                      i++){
                        var op=arr[i];
                        op&&op.variables&&op.variables.isLive&&/PlaybackAccessToken/.test(op.operationName||"")&&"popout"!==op.variables.playerType&&(op.variables.playerType="popout",
                        ch=!0)
                      }
                      ch&&(init=Object.assign({

                      },
                      init,
                      {
                        body:JSON.stringify(b)
                      }))
                    }

                  }
                  catch(_){

                  }
                  return p.call(this,
                  input,
                  init)
                };
                try{
                  w.__woTwForced=!0
                }
                catch(_){

                }
                return w
              }
              function ra(){
                try{
                  var c=window.fetch;
                  if(c&&c.__woTwForced)return;
                  window.fetch=mk(c)
                }
                catch(_){

                }

              }
              try{
                var n=0,
                iv=setInterval(function(){
                  ra();
                  if(++n>60){
                    try{
                      clearInterval(iv)
                    }
                    catch(_){

                    }

                  }

                },
                200)
              }
              catch(_){

              }

            })();
            log("scriptlet_twitch_forcepopout",
            {

            })
          }

        }
        catch(_){

        }

      }
      catch(e){
        log("scriptlet_failed",
        {
          error:String(e)
        })
      }

    }
    catch(e){
      log("scriptlet_failed",
      {
        error:String(e)
      })
    }
    if(!1&&WO.twitchAdBlock&&/(^|\.)twitch\.tv$/i.test(location.hostname))try{
      if(window.__woTwDisplayGuard)return;
      window.__woTwDisplayGuard=!0;
      var __woTwAdMark='[data-a-target="video-ad-label"],[data-a-target="video-ad-countdown"],[data-a-target="ad-countdown-timer"],[data-test-selector="sad-overlay"],.circle-countdown--text';
      var __woTwStyleId="wo-twitch-ad-css";
      var __woTwAddCss=function(){
        if(document.getElementById(__woTwStyleId))return;
        var s=document.createElement("style");
        s.id=__woTwStyleId;
        s.textContent='[aria-label="Advertisement"],#player-ads,[data-test-selector="sda-wrapper"],[class*="stream-display-ad__wrapper"],[class*="stream-display-ad__iframe"],button[aria-label="Learn more about this ad"]{display:none!important;visibility:hidden!important;pointer-events:none!important;}[class*="video-player--stream-display-ad"]{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;inset:0 auto auto 0!important;transform:none!important;}[class*="stream-display-ad__lower-third"]{height:100%!important;}.video-player__overlay .player-overlay-background:has(> div[class^="Layout-"] > div[class^="Layout-"] > div[class^="Layout-"] > a:is([href*="/how-to-allow-ads-browser"],[href="https://www.twitch.tv/turbo"])){display:none!important;}';
        (document.head||document.documentElement).appendChild(s)
      };
      var __woTwSweep=function(){
        try{
          __woTwAddCss();
          var cont=document.querySelector('[data-test-selector="video-player__video-container"]');
          var streamVid=cont&&cont.querySelector("video");
          var adActive=!1;
          document.querySelectorAll(".picture-by-picture-player").forEach(function(box){
            if(streamVid&&box.contains(streamVid))return;
            if(!box.querySelector(__woTwAdMark))return;
            box.style.setProperty("display",
            "none",
            "important");
            var av=box.querySelector("video");
            if(av){
              try{
                av.muted=!0,
                av.pause&&av.pause()
              }
              catch(_){

              }

            }
            adActive=!0
          });
          adActive&&(document.querySelectorAll(".picture-by-picture-overlay").forEach(function(o){
            o.style.setProperty("display",
            "none",
            "important")
          }),
          log("scriptlet_twitch_pbyp_ad",
          {

          }));
          var __woMainAd=!1;
          if(cont&&streamVid){
            try{
              var __root=cont.closest('[data-a-target="video-player"]')||cont.parentElement||cont;
              var __mk=__root.querySelectorAll(__woTwAdMark);
              for(var __i=0;
              __i<__mk.length;
              __i++){
                if(__mk[__i].getClientRects&&__mk[__i].getClientRects().length){
                  __woMainAd=!0;
                  break
                }

              }

            }
            catch(_){

            }

          }
          if(__woMainAd&&streamVid){
            if(!streamVid.__woAdMuted){
              streamVid.__woPrevMuted=streamVid.muted;
              streamVid.__woAdMuted=!0
            }
            streamVid.muted=!0
          }
          else if(streamVid&&streamVid.__woAdMuted){
            try{
              streamVid.muted=streamVid.__woPrevMuted
            }
            catch(_){

            }
            streamVid.__woAdMuted=!1
          }
          __woTwAdActive=__woMainAd;

        }
        catch(_){

        }

      };
      var __woTwPending=!1,
      __woTwSchedule=function(){
        __woTwPending||(__woTwPending=!0,
        (window.requestAnimationFrame||window.setTimeout)(function(){
          __woTwPending=!1,
          __woTwSweep()
        }))
      };
      try{
        new MutationObserver(__woTwSchedule).observe(document.documentElement,
        {
          childList:!0,
          subtree:!0
        })
      }
      catch(_){

      }
      var __woTwRl0=0,
      __woTwRlW=0,
      __woTwRlN=0,
      __woTwErr0=0,
      __woTwUserAct=0,
      __woTwUserPaused=!1,
      __woTwPause0=0,
      __woTwResumeAt=0,
      __woTwResumeN=0,
      __woTwHardRl=(function(){try{return Number(sessionStorage.getItem("wo_tw_hardrl"))||0}catch(_){return 0}})(),
      __woTwRoot=function(){
        try{
          var rn=document.querySelector("#root");
          if(rn&&rn._reactRootContainer&&rn._reactRootContainer._internalRoot&&rn._reactRootContainer._internalRoot.current)return rn._reactRootContainer._internalRoot.current;
          if(rn){
            var k=Object.keys(rn).find(function(x){
              return 0===x.indexOf("__reactContainer")
            });
            if(k)return rn[k]
          }

        }
        catch(_){

        }
        return null
      },
      __woTwFind=function(root,
      c){
        if(!root)return null;
        try{
          if(root.stateNode&&c(root.stateNode))return root.stateNode
        }
        catch(_){

        }
        var n=root.child,
        r;
        while(n){
          r=__woTwFind(n,
          c);
          if(r)return r;
          n=n.sibling
        }
        return null
      },
      __woTwGetPlayer=function(){
        var root=__woTwRoot();
        if(!root)return null;
        var p=__woTwFind(root,
        function(n){
          return n.setPlayerActive&&n.props&&n.props.mediaPlayerInstance
        });
        p=p&&p.props&&p.props.mediaPlayerInstance?p.props.mediaPlayerInstance:null;
        if(p&&p.playerInstance)p=p.playerInstance;
        var st=__woTwFind(root,
        function(n){
          return n.setSrc&&n.setInitialPlaybackSettings
        });
        return{
          player:p,
          state:st
        }

      },
      __woTwReload=function(){
        var now=Date.now();
        if(now-__woTwRlW>6e4){
          __woTwRlW=now,
          __woTwRlN=0
        }
        if(__woTwRlN>=6||now-__woTwRl0<5e3)return;
        var ps;
        try{
          ps=__woTwGetPlayer()
        }
        catch(_){
          return
        }
        if(!ps||!ps.state||"function"!=typeof ps.state.setSrc)return;
        __woTwRl0=now,
        __woTwRlN++;
        var q,
        m,
        vol;
        try{
          q=localStorage.getItem("video-quality");
          m=localStorage.getItem("video-muted");
          vol=localStorage.getItem("volume")
        }
        catch(_){

        }
        try{
          ps.state.setSrc({
            isNewMediaPlayerInstance:!0,
            refreshAccessToken:!0
          })
        }
        catch(_){
          return
        }
        try{
          ps.player&&ps.player.play&&ps.player.play()
        }
        catch(_){

        }
        setTimeout(function(){
          try{
            q&&localStorage.setItem("video-quality",
            q);
            m&&localStorage.setItem("video-muted",
            m);
            vol&&localStorage.setItem("volume",
            vol)
          }
          catch(_){

          }

        },
        3e3);
        try{
          log("scriptlet_twitch_reload",
          {

          })
        }
        catch(_){

        }

      };
      var __woTwAdActive=!1,
      __woTwVLast=-1,
      __woTwVStall=0,
      __woTwVFix=0,
      __woTwVTries=0,
      __woTwSpinSince=0,
      __woTwSpinFix=0,
      __woTwLooksLoading=function(root){
        try{
          return !!(root&&root.querySelector('[data-a-target*="spinner"],[class*="spinner"],[role="progressbar"],[aria-busy="true"],[data-a-target*="loading"],[class*="loading"]'))
        }
        catch(_){
          return!1
        }

      },
      __woTwLooksError=function(root){
        try{
          var nodes=root&&root.querySelectorAll('[data-a-target*="error"],[data-test-selector*="error"],[class*="error"],[role="alert"],[data-a-target*="player-overlay"]');
          if(!nodes)return!1;
          for(var i=0;
          i<nodes.length&&i<8;
          i++){
            if(/Error #?\d{4}/i.test(nodes[i].textContent||""))return!0
          }

        }
        catch(_){

        }
        return!1
      },
      __woTwUnstall=function(v,
      hard){
        try{
          var s=v.seekable;
          if(Infinity===v.duration&&s&&s.length){
            var e=s.end(s.length-1);
            e-v.currentTime>1&&(v.currentTime=e-.5)
          }

        }
        catch(_){

        }
        var go=function(){
          try{
            var p=v.play&&v.play();
            p&&p.catch&&p.catch(function(){

            })
          }
          catch(_){

          }

        };
        if(hard){
          try{
            v.pause()
          }
          catch(_){

          }
          setTimeout(go,
          80)
        }
        else go()
      },
      __woTwWatch=function(){
        try{
          var now=Date.now();
          var __vp=document.querySelector('[data-a-target="video-player"]')||document.querySelector(".video-player");
          var cont=document.querySelector('[data-test-selector="video-player__video-container"]'),
          v=cont&&cont.querySelector("video");
          if(__woTwLooksError(__vp)||v&&v.error){
            __woTwErr0||(__woTwErr0=now);
            __woTwReload();
            if(now-__woTwErr0>9e3&&now-__woTwHardRl>3e5){
              __woTwHardRl=now;
              try{sessionStorage.setItem("wo_tw_hardrl",String(now))}catch(_){}
              try{log("scriptlet_twitch_hard_reload",{})}catch(_){}
              try{location.reload()}catch(_){}
            }
            return
          }
          __woTwErr0=0;
          if(!v||v.ended){
            __woTwVLast=-1,
            __woTwVStall=0,
            __woTwSpinSince=0;
            return
          }
          if(v.paused&&v.readyState<3&&__woTwLooksLoading(__vp)){
            __woTwSpinSince||(__woTwSpinSince=now);
            if(now-__woTwSpinSince>8e3&&now-__woTwSpinFix>3e4){
              __woTwSpinFix=now,
              __woTwSpinSince=0,
              __woTwVLast=-1,
              __woTwVStall=0,
              __woTwReload(),
              log("scriptlet_twitch_spinner_recover",
              {

              })
            }
            return
          }
          __woTwSpinSince=0;
          if(v.paused){
            __woTwVLast=-1,
            __woTwVStall=0;
            if(__woTwUserPaused||v.ended||"visible"!==document.visibilityState){
              __woTwPause0=0,
              __woTwResumeN=0;
              return
            }
            __woTwPause0||(__woTwPause0=now);
            if(now-__woTwPause0>2500&&now-__woTwResumeAt>4e3){
              __woTwResumeAt=now,
              __woTwResumeN++;
              __woTwResumeN>=3?(__woTwResumeN=0,
              __woTwPause0=0,
              __woTwReload()):__woTwUnstall(v,
              __woTwResumeN>=2),
              log("scriptlet_twitch_autoresume",
              {
                n:__woTwResumeN
              })
            }
            return
          }
          __woTwPause0=0,
          __woTwResumeN=0;
          var t=v.currentTime;
          Math.abs(t-__woTwVLast)<.05&&t>0?__woTwVStall++:__woTwVStall=0,
          __woTwVLast=t;
          if(__woTwVStall>=3&&now-__woTwVFix>6e3){
            __woTwVTries=__woTwVFix&&now-__woTwVFix<15e3?__woTwVTries+1:1,
            __woTwVFix=now,
            __woTwVStall=0,
            __woTwAdActive?__woTwUnstall(v,
            __woTwVTries>=2):(v.readyState<3||__woTwVTries>=2?__woTwReload():__woTwUnstall(v,
            !1)),
            log("scriptlet_twitch_unstall",
            {
              n:__woTwVTries,
              ad:!!__woTwAdActive
            })
          }

        }
        catch(_){

        }

      };
      setInterval(__woTwWatch,
      1e3);
      var __woTwOnVis=function(){
        if("visible"!==document.visibilityState)return;
        setTimeout(function(){
          try{
            var vp=document.querySelector('[data-a-target="video-player"]')||document.querySelector(".video-player"),
            cont=document.querySelector('[data-test-selector="video-player__video-container"]'),
            v=cont&&cont.querySelector("video");
            if(__woTwLooksError(vp)||v&&v.error)__woTwReload()
          }
          catch(_){

          }

        },
        600)
      };
      try{
        document.addEventListener("visibilitychange",
        __woTwOnVis),
        window.addEventListener("focus",
        __woTwOnVis)
      }
      catch(_){

      }
      try{
        ["pointerdown",
        "keydown",
        "click"].forEach(function(ev){
          document.addEventListener(ev,
          function(e){
            e&&!1!==e.isTrusted&&(__woTwUserAct=Date.now())
          },
          !0)
        }),
        document.addEventListener("pause",
        function(e){
          e&&e.target&&"VIDEO"===e.target.tagName&&(__woTwUserPaused=Date.now()-__woTwUserAct<1500)
        },
        !0),
        document.addEventListener("play",
        function(e){
          e&&e.target&&"VIDEO"===e.target.tagName&&(__woTwUserPaused=!1)
        },
        !0)
      }
      catch(_){

      }
      setInterval(__woTwSweep,
      1e3),
      __woTwSweep(),
      log("scriptlet_twitch_displayad",
      {

      })
    }
    catch(e){
      log("scriptlet_failed",
      {
        error:String(e)
      })
    }
    const trustedMediaHost=/(^|\.)((youtube|youtu)\.be|youtube\.com|youtube-nocookie\.com|googlevideo\.com|ytimg\.com|twitch\.tv|ttvnw\.net|jtvnw\.net|twitchcdn\.net|x\.com|twitter\.com|twimg\.com)$/i.test(location.hostname);
    if(WO.blockAutoplay&&!trustedMediaHost)try{
      let userGestured=!1;
      ["click",
      "keydown",
      "pointerdown",
      "touchstart"].forEach(ev=>window.addEventListener(ev,
      ()=>{
        userGestured=!0,
        setTimeout(()=>{
          userGestured=!1
        },
        1e3)
      },
      !0));
      const tameMedia=m=>{
        try{
          if(userGestured)return;
          m.autoplay=!1;
          const isFreeMutedAudio="AUDIO"===m.tagName&&!0===m.muted;
          m.paused||isFreeMutedAudio||m.pause()
        }
        catch(_){

        }

      };
      try{
        const proto=HTMLMediaElement&&HTMLMediaElement.prototype;
        if(proto&&proto.play){
          const realPlay=proto.play;
          proto.play=function(){
            const isFreeMutedAudio=this&&"AUDIO"===this.tagName&&!0===this.muted;
            if(!userGestured&&!isFreeMutedAudio){
              try{
                this.pause()
              }
              catch(_){

              }
              return Promise.reject(new DOMException("Autoplay blocked by WardenOne",
              "NotAllowedError"))
            }
            return realPlay.apply(this,
            arguments)
          }

        }

      }
      catch(_){

      }
      const sweepMedia=root=>{
        try{
          (root||document).querySelectorAll("video[autoplay],audio[autoplay],video,audio").forEach(tameMedia)
        }
        catch(_){

        }

      };
      document.documentElement&&sweepMedia(document);
      try{
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)n&&n.tagName&&/^(VIDEO|AUDIO)$/.test(n.tagName)?tameMedia(n):n&&n.querySelectorAll&&sweepMedia(n)
        })
      }
      catch(_){

      }
      log("resource_autoplay_on",
      {

      })
    }
    catch(_){

    }
    if(WO.lazyLoadMedia)try{
      let io=null;
      try{
        io=new IntersectionObserver(entries=>{
          entries.forEach(en=>{
            if(en.isIntersecting){
              const el=en.target;
              try{
                const s=el.getAttribute("data-wo-src");
                s&&(el.src=s,
                el.removeAttribute("data-wo-src"))
              }
              catch(_){

              }
              io.unobserve(el)
            }

          })
        },
        {
          rootMargin:"300px"
        })
      }
      catch(_){

      }
      const isOffscreen=el=>{
        try{
          const r=el.getBoundingClientRect();
          return r.top>innerHeight+300||r.bottom<-300
        }
        catch(_){
          return!1
        }

      },
      lazify=el=>{
        try{
          if(!el||!el.tagName)return;
          if("IMG"===el.tagName)el.getAttribute("loading")||el.setAttribute("loading",
          "lazy"),
          el.getAttribute("decoding")||el.setAttribute("decoding",
          "async");
          else if("IFRAME"===el.tagName)el.getAttribute("loading")||el.setAttribute("loading",
          "lazy")

        }
        catch(_){

        }

      },
      sweepLazy=root=>{
        try{
          (root||document).querySelectorAll("img,iframe").forEach(lazify)
        }
        catch(_){

        }

      };
      document.documentElement&&sweepLazy(document);
      try{
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)n&&n.tagName&&/^(IMG|IFRAME)$/.test(n.tagName)?lazify(n):n&&n.querySelectorAll&&sweepLazy(n)
        })
      }
      catch(_){

      }
      log("resource_lazyload_on",
      {

      })
    }
    catch(_){

    }
    let socialWidgetGuardInstalled=!1;
    const installSocialWidgetGuard=()=>{
      if(socialWidgetGuardInstalled||!WO.socialWidgetGuard||/(^|\.)(x\.com|twitter\.com)$/i.test(location.hostname))return;
      socialWidgetGuardInstalled=!0;
      const makeSocialPlaceholder=(provider,
      restore,
      minHeight)=>{
        const holder=document.createElement("div"),
        btn=document.createElement("button");
        return holder.setAttribute("data-wo-social-placeholder",
        provider),
        holder.setAttribute("style",
        "box-sizing:border-box;display:grid;place-items:center;min-height:"+Math.max(96,
        minHeight||140)+"px;border:1px solid rgba(80,60,100,.22);border-radius:8px;background:rgba(250,250,252,.96);color:#352842;font:600 13px system-ui,sans-serif;padding:14px;text-align:center;"),
        btn.type="button",
        btn.textContent="Load "+provider+" embed",
        btn.setAttribute("style",
        "cursor:pointer;border:0;border-radius:8px;background:#3d2a52;color:#fff;font:700 13px system-ui,sans-serif;padding:9px 13px;"),
        btn.addEventListener("click",
        e=>{
          if(!e||!1!==e.isTrusted){
            try{
              restore()
            }
            catch(_){

            }
            log("loaded_social_widget",
            {
              provider:provider
            })
          }

        }),
        holder.appendChild(btn),
        holder
      },
      guardSocialNode=el=>{
        try{
          if(!WO.socialWidgetGuard||!el||!el.tagName||el.getAttribute("data-wo-social-loaded")||el.getAttribute("data-wo-social-placeholder"))return;
          if("SCRIPT"===el.tagName)return;
          const provider=(el=>{
            try{
              const tag=el&&el.tagName||"",
              cls=String(el&&el.className||""),
              id=String(el&&el.id||"");
              if(/twitter-(tweet|timeline)|twitter-tweet|twitter-timeline/i.test(cls))return"X";
              if(/instagram-media/i.test(cls))return"Instagram";
              if(/tiktok-embed/i.test(cls))return"TikTok";
              if(/\bfb-(post|video|page|like|share-button|comments)\b/i.test(cls+" "+id))return"Facebook";
              if("IFRAME"===tag||"SCRIPT"===tag)return(raw=>{
                try{
                  const u=toURL(raw);
                  if(!u)return"";
                  const h=u.hostname.replace(/^www\./,
                  "").toLowerCase(),
                  p=u.pathname.toLowerCase();
                  if((/(^|\.)facebook\.com$/i.test(h)||"connect.facebook.net"===h||/(^|\.)fbcdn\.net$/i.test(h))&&/plugins|sdk|xfbml|like|share|comments|embed/i.test(p+u.search))return"Facebook";
                  if("platform.twitter.com"===h||"syndication.twitter.com"===h||/(^|\.)(twitter|x)\.com$/i.test(h)&&/embed|widget|timeline|status|i\/cards/i.test(p+u.search))return"X";
                  if(/(^|\.)instagram\.com$/i.test(h)&&/embed|p\/|reel\//i.test(p+u.search))return"Instagram";
                  if(/(^|\.)tiktok\.com$/i.test(h)&&/embed|player|video/i.test(p+u.search))return"TikTok"
                }
                catch(_){

                }
                return""
              })(el.getAttribute("src")||el.src||"")
            }
            catch(_){

            }
            return""
          })(el);
          if(!provider)return;
          if("SCRIPT"===el.tagName)return el.setAttribute("data-wo-social-guarded",
          "1"),
          el.parentNode&&el.parentNode.removeChild(el),
          void log("blocked_social_widget",
          {
            provider:provider,
            kind:"script"
          });
          const rect=el.getBoundingClientRect&&el.getBoundingClientRect(),
          minHeight=rect&&rect.height?Math.min(360,
          Math.max(96,
          Math.round(rect.height))):140;
          if("IFRAME"===el.tagName){
            const src=el.getAttribute("src")||el.src||"",
            holder=makeSocialPlaceholder(provider,
            ()=>{
              el.setAttribute("data-wo-social-loaded",
              "1"),
              src&&el.setAttribute("src",
              src),
              holder.replaceWith(el)
            },
            minHeight);
            return src&&(el.setAttribute("data-wo-social-src",
            src),
            el.removeAttribute("src")),
            el.parentNode&&el.parentNode.replaceChild(holder,
            el),
            void log("blocked_social_widget",
            {
              provider:provider,
              kind:"iframe"
            })
          }
          const clone=el.cloneNode(!0),
          holder=makeSocialPlaceholder(provider,
          ()=>{
            clone.setAttribute&&clone.setAttribute("data-wo-social-loaded",
            "1"),
            holder.replaceWith(clone),
            (provider=>{
              try{
                const src=(provider=>({
                  Facebook:"https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v19.0",
                  X:"https://platform.twitter.com/widgets.js",
                  Instagram:"https://www.instagram.com/embed.js",
                  TikTok:"https://www.tiktok.com/embed.js"
                }
                [provider]||""))(provider);
                if(!src)return;
                const s=document.createElement("script");
                s.async=!0,
                s.src=src,
                s.setAttribute("data-wo-social-loaded",
                "1"),
                (document.head||document.documentElement).appendChild(s)
              }
              catch(_){

              }

            })(provider)
          },
          minHeight);
          el.parentNode&&el.parentNode.replaceChild(holder,
          el),
          log("blocked_social_widget",
          {
            provider:provider,
            kind:"embed"
          })
        }
        catch(_){

        }

      },
      sweepSocialWidgets=root=>{
        try{
          (root||document).querySelectorAll("iframe[src],script[src],blockquote.twitter-tweet,blockquote.instagram-media,blockquote.tiktok-embed,.fb-post,.fb-video,.fb-page,.fb-like,.fb-share-button,.fb-comments,.twitter-tweet,.twitter-timeline,.tiktok-embed").forEach(guardSocialNode)
        }
        catch(_){

        }

      };
      document.documentElement&&sweepSocialWidgets(document);
      try{
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)n&&n.tagName&&guardSocialNode(n),
          n&&n.querySelectorAll&&sweepSocialWidgets(n)
        })
      }
      catch(_){

      }
      log("social_widget_guard_on",
      {

      })
    };
    installSocialWidgetGuard();
    try{
      document.addEventListener("wo-config-change",
      installSocialWidgetGuard)
    }
    catch(_){

    }
    if(WO.killPrefetch)try{
      const SPEC_REL=/^(prefetch|prerender|preload|dns-prefetch|preconnect|modulepreload)$/i,
      killLink=el=>{
        try{
          if(el&&"LINK"===el.tagName){
            const rel=(el.getAttribute("rel")||"").trim();
            if(SPEC_REL.test(rel))return void(el.parentNode&&el.parentNode.removeChild(el))
          }
          el&&"SCRIPT"===el.tagName&&/speculationrules/i.test(el.type||"")&&el.parentNode&&el.parentNode.removeChild(el)
        }
        catch(_){

        }

      },
      sweepLinks=root=>{
        try{
          (root||document).querySelectorAll('link[rel],script[type="speculationrules"]').forEach(killLink)
        }
        catch(_){

        }

      };
      document.documentElement&&sweepLinks(document);
      try{
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)!n||"LINK"!==n.tagName&&"SCRIPT"!==n.tagName?n&&n.querySelectorAll&&sweepLinks(n):killLink(n)
        })
      }
      catch(_){

      }
      log("resource_prefetch_off",
      {

      })
    }
    catch(_){

    }
    if(WO.throttleBackgroundTabs&&!trustedMediaHost)try{
      let pauseStyle=null;
      const setHiddenStyle=on=>{
        try{
          on?(pauseStyle||(pauseStyle=document.createElement("style"),
          pauseStyle.id="rg-bg-throttle",
          pauseStyle.textContent="*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}"),
          (document.head||document.documentElement).appendChild(pauseStyle)):pauseStyle&&pauseStyle.parentNode&&pauseStyle.parentNode.removeChild(pauseStyle)
        }
        catch(_){

        }

      };
      let pausedByUs=[];
      const pauseBackgroundVideos=()=>{
        try{
          pausedByUs=[],
          document.querySelectorAll("video").forEach(v=>{
            try{
              v.paused||v.ended||(v.pause(),
              pausedByUs.push(v))
            }
            catch(_){

            }

          })
        }
        catch(_){

        }

      },
      resumeBackgroundVideos=()=>{
        try{
          pausedByUs.forEach(v=>{
            try{
              v.isConnected&&v.paused&&v.play().catch(()=>{

              })
            }
            catch(_){

            }

          }),
          pausedByUs=[]
        }
        catch(_){

        }

      },
      realRaf=window.requestAnimationFrame,
      realCaf=window.cancelAnimationFrame;
      realRaf&&(window.requestAnimationFrame=function(cb){
        return document.hidden?-setTimeout(()=>{
          try{
            cb(performance.now())
          }
          catch(_){

          }

        },
        500)-1:realRaf.call(window,
        cb)
      },
      window.cancelAnimationFrame=function(id){
        if(!("number"==typeof id&&id<0))return realCaf?realCaf.call(window,
        id):void 0;
        clearTimeout(-id-1)
      });
      const onVis=()=>{
        const hidden=document.hidden;
        setHiddenStyle(hidden),
        hidden?pauseBackgroundVideos():resumeBackgroundVideos()
      };
      document.addEventListener("visibilitychange",
      onVis,
      !0),
      onVis(),
      log("resource_bgthrottle_on",
      {

      })
    }
    catch(_){

    }
    if(WO.deAmp)try{
      const findCanonical=()=>{
        try{
          const html=document.documentElement;
          let isAmpDoc=!1;
          try{
            if(html){
              const names=html.getAttributeNames?html.getAttributeNames():[];
              isAmpDoc=-1!==names.indexOf("amp")||names.some(n=>9889===n.charCodeAt(0))
            }

          }
          catch(_){

          }
          if(!isAmpDoc)return null;
          const can=document.querySelector('link[rel="canonical"]');
          if(can&&can.href){
            const target=new URL(can.href,
            location.href);
            if(/^https?:$/.test(target.protocol)&&target.href!==location.href)return target.href
          }

        }
        catch(_){

        }
        return null
      },
      goCanonical=()=>{
        const url=findCanonical();
        if(url){
          log("deamp_redirect",
          {
            to:url
          });
          try{
            location.replace(url)
          }
          catch{
            location.href=url
          }

        }

      };
      document.querySelector('link[rel="canonical"]')?goCanonical():document.addEventListener("DOMContentLoaded",
      goCanonical,
      {
        once:!0
      });
      const deAmpUrl=href=>{
        try{
          const u=new URL(href,
          location.href),
          m=u.pathname.match(/\/amp\/s\/(.+)$/);
          if(/(^|\.)google\.[a-z.]+$/i.test(u.hostname)&&m){
            const real=decodeURIComponent(m[1]);
            return real.startsWith("http")?real:"https://"+real
          }
          if(/(^|\.)ampproject\.org$/i.test(u.hostname)){
            const mm=u.pathname.match(/\/c\/s\/(.+)$/);
            if(mm){
              const real=decodeURIComponent(mm[1]);
              return real.startsWith("http")?real:"https://"+real
            }

          }
          return null
        }
        catch(_){
          return null
        }

      },
      fixLinks=root=>{
        try{
          (root||document).querySelectorAll("a[href]").forEach(a=>{
            const fixed=deAmpUrl(a.getAttribute("href"));
            fixed&&a.setAttribute("href",
            fixed)
          })
        }
        catch(_){

        }

      };
      document.body&&fixLinks(document);
      try{
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)if(n&&"A"===n.tagName){
            const fx=deAmpUrl(n.getAttribute&&n.getAttribute("href"));
            fx&&n.setAttribute("href",
            fx)
          }
          else n&&n.querySelectorAll&&fixLinks(n)
        })
      }
      catch(_){

      }
      log("deamp_on",
      {

      })
    }
    catch(_){

    }
    if(WO.capReferrer)try{
      const setMeta=()=>{
        try{
          if(document.querySelector('meta[name="referrer"][data-rg]'))return;
          const m=document.createElement("meta");
          m.name="referrer",
          m.content="strict-origin-when-cross-origin",
          m.setAttribute("data-rg",
          "1"),
          (document.head||document.documentElement).appendChild(m)
        }
        catch(_){

        }

      };
      setMeta(),
      document.head||document.addEventListener("DOMContentLoaded",
      setMeta,
      {
        once:!0
      });
      const stampRef=el=>{
        try{
          !el||"A"!==el.tagName&&"AREA"!==el.tagName&&"FORM"!==el.tagName&&"IMG"!==el.tagName&&"IFRAME"!==el.tagName||el.getAttribute("referrerpolicy")||el.setAttribute("referrerpolicy",
          "strict-origin-when-cross-origin")
        }
        catch(_){

        }

      },
      sweepRef=root=>{
        try{
          (root||document).querySelectorAll("a,area,form,img,iframe").forEach(stampRef)
        }
        catch(_){

        }

      };
      document.documentElement&&sweepRef(document);
      try{
        woObserve(muts=>{
          for(const mu of muts)for(const n of mu.addedNodes)n&&n.tagName&&stampRef(n),
          n&&n.querySelectorAll&&sweepRef(n)
        })
      }
      catch(_){

      }
      log("capreferrer_on",
      {

      })
    }
    catch(_){

    }
    if(!1&&WO.autoRejectConsent&&!/(^|\.)(paypal\.com|stripe\.com|checkout\.com|adyen\.com|braintreepayments\.com|braintreegateway\.com|klarna\.com|squareup\.com|cash\.app)$/i.test(location.hostname))try{
      const REJECT_TEXT=[/^reject all$/i,
      /^reject all non-essential/i,
      /^reject optional/i,
      /^decline all$/i,
      /^deny all$/i,
      /^refuse all$/i,
      /^reject$/i,
      /^decline$/i,
      /^refuse$/i,
      /^deny$/i,
      /^only (necessary|essential|required)/i,
      /^(use )?necessary( cookies)? only$/i,
      /^essential( cookies)? only$/i,
      /^reject non-?essential/i,
      /^do not (accept|agree)/i,
      /^do not (sell|share)/i,
      /^don'?t consent/i,
      /^object to all/i,
      /^manage.*reject/i,
      /^continue without accepting/i,
      /^save without accepting/i,
      /^alle ablehnen$/i,
      /^tout refuser$/i,
      /^rechazar todo$/i,
      /^rifiuta tutt/i,
      /^afwijzen$/i,
      /^alles weigeren$/i,
      /^odrzu/i,
      /^rejeitar tudo$/i,
      /^avvisa alla$/i,
      /^reject all cookies$/i],
      ACCEPT_TEXT=/(accept|agree|allow all|got it|i (accept|agree)|enable all|consent|akzeptier|tout accepter|aceptar)/i,
      CONSENT_CTX=/(cookie|consent|gdpr|ccpa|cpra|cmp|privacy|tracking|data protection|gestion des cookies|datenschutz|onetrust|didomi|usercentrics|trustarc|truste|sourcepoint|quantcast|iubenda|cookiebot|cookieyes|osano|termly|axeptio|cookielaw|cookiehub|advertising choices|do not sell|do not share)/i,
      PROTECT_CONSENT_CTX=/(sign[\s-]?in|log[\s-]?in|sign[\s-]?up|register|account|password|passcode|2fa|verification code|payment|billing|checkout|purchase|place order|buy now|pay now|card number|shipping|delivery address|delete account|deactivate|unsubscribe|confirm your)/i,
      looksReject=txt=>REJECT_TEXT.some(re=>re.test(txt)),
      releaseConsentLock=()=>{
        try{
          const unlock=n=>{
            if(!n)return;
            n.style.setProperty("overflow",
            "auto",
            "important"),
            n.style.setProperty("pointer-events",
            "auto",
            "important"),
            n.classList&&["modal-open",
            "no-scroll",
            "noscroll",
            "overflow-hidden",
            "is-clipped",
            "ReactModal__Body--open"].forEach(c=>n.classList.remove(c))
          };
          unlock(document.body),
          unlock(document.documentElement);
          const visibleModal=Array.from(document.querySelectorAll('[aria-modal="true"],dialog[open]')).some(n=>{
            try{
              const cs=getComputedStyle(n),
              r=n.getBoundingClientRect();
              return"none"!==cs.display&&"hidden"!==cs.visibility&&r.width>8&&r.height>8
            }
            catch(_){
              return!1
            }

          });
          document.querySelectorAll("[inert]").forEach(n=>{
            try{
              n.removeAttribute("inert")
            }
            catch(_){

            }

          }),
          visibleModal||document.querySelectorAll('body > [aria-hidden="true"],main[aria-hidden="true"],#root[aria-hidden="true"],#app[aria-hidden="true"],[data-reactroot][aria-hidden="true"]').forEach(n=>{
            try{
              n.removeAttribute("aria-hidden")
            }
            catch(_){

            }

          }),
          document.querySelectorAll('body > .modal-backdrop,body > [class*="backdrop" i],body > [id*="backdrop" i],body > [class*="overlay" i],body > [id*="overlay" i],body > [class*="scrim" i],body > [id*="scrim" i],body > [class*="veil" i],body > [id*="veil" i]').forEach(n=>{
            try{
              const cs=getComputedStyle(n),
              r=n.getBoundingClientRect(),
              text=(n.innerText||n.textContent||"").trim(),
              blob=text+" "+(n.id||"")+" "+(n.className||""),
              full=r.width>=innerWidth*.7&&r.height>=innerHeight*.7&&r.left<=innerWidth*.18&&r.top<=innerHeight*.18,
              fixed=/^(fixed|absolute|sticky)$/i.test(cs.position),
              looksBackdrop=/backdrop|overlay|scrim|veil|modal|cookie|consent|cmp|onetrust|didomi|trustarc|usercentrics/i.test(blob);
              fixed&&full&&(looksBackdrop||text.length<60)&&n.style.setProperty("display",
              "none",
              "important")
            }
            catch(_){

            }

          })
        }
        catch(_){

        }

      },
      tryReject=()=>{
        try{
          const btns=document.querySelectorAll('button, [role="button"], a[href="#"], input[type="button"], input[type="submit"], div[tabindex], span[role="button"], label, [data-action], [data-testid], [data-test], [data-cy]');
          let best=null;
          for(const b of btns){
            const txt=(b.textContent||b.value||b.getAttribute&&b.getAttribute("aria-label")||"").trim();
            if(!txt||txt.length>80)continue;
            if(PROTECT_CONSENT_CTX.test(txt))continue;
            if(ACCEPT_TEXT.test(txt)&&!looksReject(txt))continue;
            if(!looksReject(txt))continue;
            let ctx=!1,
            protectedCtx=!1,
            node=b;
            for(let i=0;
            i<6&&node;
            i++){
              try{
                const sample=(node.textContent||"").slice(0,
                700);
                if(PROTECT_CONSENT_CTX.test(sample)){
                  protectedCtx=!0;
                  break
                }
                if(CONSENT_CTX.test(sample)||CONSENT_CTX.test(node.id||"")||CONSENT_CTX.test(node.className||"")){
                  ctx=!0;
                  break
                }

              }
              catch(_){

              }
              node=node.parentElement
            }
            if(ctx&&!protectedCtx){
              best=b;
              break
            }

          }
          if(best)return best.click(),
          releaseConsentLock(),
          setTimeout(releaseConsentLock,
          250),
          setTimeout(releaseConsentLock,
          900),
          log("consent_rejected",
          {

          }),
          !0
        }
        catch(_){

        }
        return!1
      };
      let tries=0;
      const attempt=()=>{
        tries++,
        tryReject()||tries<8&&setTimeout(attempt,
        500)
      };
      document.body?attempt():document.addEventListener("DOMContentLoaded",
      attempt,
      {
        once:!0
      })
    }
    catch(_){

    }
    if(WO.behavioralScan||WO.fingerprintProbeDetection)try{
      const here=regDomain(location.hostname),
      fullHost=location.hostname.toLowerCase(),
      KNOWN_GOOD_BEHAVE=/(google|gstatic|googleapis|youtube|googlevideo|ytimg|twitch|ttvnw|jtvnw|twitchcdn|facebook|fbcdn|instagram|apple|icloud|microsoft|live|office|windows|amazon|cloudflare|akamai|fastly|github|wikipedia|mozilla|stripe|paypal|cloudfront|jsdelivr|unpkg)\./i;
      if(here&&"localhost"!==here&&!/^\d+\.\d+\.\d+\.\d+$/.test(fullHost)&&!KNOWN_GOOD_BEHAVE.test(here)){
        let score=0;
        const reasons=[],
        seenSignals=new Set;
        let lastWarnBand=0,
        establishedDomain=!1;
        const riskLevel=()=>score>=100?"Dangerous":score>=60?"Suspicious":score>=30?"Caution":"Safe",
        riskBand=()=>score>=100?3:score>=60?2:score>=30?1:0,
        updatePageRisk=key=>{
          try{
            const risk=WO.__pageRisk||{

            };
            risk.behavioralScore=score,
            risk.behavioralLevel=riskLevel(),
            risk.behavioralReasons=reasons.slice(0,
            10),
            "new-domain"===key&&(risk.newDomain=!0),
            "young-domain"===key&&(risk.youngDomain=!0),
            WO.__pageRisk=risk
          }
          catch(_){

          }

        },
        addSignal=(pts,
        why,
        key)=>{
          const sigKey=key||why;
          seenSignals.has(sigKey)||(seenSignals.add(sigKey),
          score+=pts,
          reasons.includes(why)||reasons.push(why),
          updatePageRisk(sigKey),
          maybeWarn())
        },
        knownLogger=(WO.grabberDomains||[]).find(d=>here===d||here.endsWith("."+d));
        knownLogger&&addSignal(100,
        "Known IP logger domain ("+knownLogger+")",
        "known-logger");
        try{
          const nav=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];
          nav&&nav.redirectCount>=2&&addSignal(20,
          "Multiple redirects before this page loaded",
          "multi-redirect")
        }
        catch(_){

        }
        /(^|\.)(bit\.ly|bitly\.com|tinyurl\.com|is\.gd|t\.co|short\.io|rebrand\.ly|rebrandly\.com|rb\.gy|cutt\.ly|tiny\.cc|v\.gd|ow\.ly|buff\.ly|shorturl\.at|bl\.ink|soo\.gd|lnkd\.in)$/i.test(here)&&addSignal(20,
        "Known URL shortener domain",
        "shortener-domain"),
        (s=>{
          if(s.length<8)return!1;
          const digits=(s.match(/\d/g)||[]).length,
          hexish=/^[a-f0-9]{12,}$/i.test(s),
          noVowelRun=/[bcdfghjklmnpqrstvwxz]{6,}/i.test(s),
          manyDigits=digits>=.35*s.length&&digits>=4;
          return hexish||noVowelRun||manyDigits
        })(here.split(".")[0]||"")&&addSignal(10,
        "Random-looking domain name",
        "random-host"),
        /\.(cfd|sbs|top|xyz|click|link|live|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|skin|bar|fit)$/i.test(fullHost)&&addSignal(10,
        "Throwaway-style TLD",
        "abuse-tld"),
        ((fullHost.match(/-/g)||[]).length>=3||fullHost.length>=40)&&addSignal(10,
        "Unusually long / hyphenated host",
        "long-host");
        let interacted=!1;
        ["click",
        "keydown",
        "pointerdown",
        "touchstart",
        "scroll"].forEach(ev=>window.addEventListener(ev,
        ()=>{
          interacted=!0
        },
        {
          capture:!0,
          once:!0
        }));
        const loadedAt=Date.now(),
        isForeign=url=>{
          try{
            if(VERIFICATION_FLOW_POLICY.expectsNoticeUrl(url))return!1;
            const h=regDomain(new URL(url,
            location.href).hostname);
            return h&&h!==here&&!h.endsWith("."+here)&&!here.endsWith("."+h)&&!KNOWN_GOOD_BEHAVE.test(h)
          }
          catch{
            return!1
          }

        },
        sawForeignCall=(url,
        how)=>{
          Date.now()-loadedAt<4e3&&!interacted&&isForeign(url)&&addSignal(20,
          "Hidden cross-site request before any click ("+how+")",
          "hidden-request")
        };
        if(window.fetch){
          const rf=window.fetch;
          window.fetch=function(input,
          init){
            try{
              sawForeignCall("string"==typeof input?input:input&&input.url,
              "fetch")
            }
            catch(_){

            }
            return rf.apply(this,
            arguments)
          }

        }
        if(navigator.sendBeacon){
          const rb=navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon=function(url,
          data){
            try{
              sawForeignCall(url,
              "beacon")
            }
            catch(_){

            }
            return rb(url,
            data)
          }

        }
        if(window.XMLHttpRequest){
          const RX=window.XMLHttpRequest,
          oOpen=RX.prototype.open;
          RX.prototype.open=function(m,
          url,
          ...rest){
            try{
              this.__wo_beh_url=url,
              sawForeignCall(url,
              "xhr")
            }
            catch(_){

            }
            return oOpen.call(this,
            m,
            url,
            ...rest)
          }

        }
        try{
          const desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,
          "src");
          desc&&desc.set&&Object.defineProperty(HTMLImageElement.prototype,
          "src",
          {
            configurable:!0,
            get(){
              return desc.get.call(this)
            },
            set(v){
              try{
                sawForeignCall(v,
                "pixel")
              }
              catch(_){

              }
              return desc.set.call(this,
              v)
            }

          })
        }
        catch(_){

        }
        document.addEventListener("wo-event",
        e=>{
          try{
            const t=e.detail&&e.detail.type;
            ("detected_grabber_domain"===t||/^blocked_grabber_/.test(t))&&addSignal(100,
            "Known IP logger service touched this page",
            "known-logger-event"),
            "blocked_gestureless_nav"!==t&&"blocked_redirect_chain"!==t&&"blocked_meta_refresh"!==t||addSignal(20,
            "Automatic redirect/redirect-chain behavior",
            "auto-redirect")
          }
          catch(_){

          }

        },
        !0);
        let fpHits=0;
        const noteFingerprint=why=>{
          if(!WO.fingerprintProbeDetection)return;
          const next=fpHits+1,
          points=VERIFICATION_FLOW_POLICY.fingerprintNoticePoints(next);
          if(!points)return;
          fpHits=next,
          fpHits>=3?addSignal(points,
          "Heavy browser fingerprinting behavior",
          "heavy-fingerprint"):addSignal(points,
          why,
          "fingerprint-"+why)
        };
        try{
          const cProto=HTMLCanvasElement.prototype,
          realDataUrl=cProto.toDataURL;
          realDataUrl&&(cProto.toDataURL=function(...args){
            try{
              noteFingerprint("Canvas fingerprint probe")
            }
            catch(_){

            }
            return realDataUrl.apply(this,
            args)
          });
          const realBlob=cProto.toBlob;
          realBlob&&(cProto.toBlob=function(...args){
            try{
              noteFingerprint("Canvas fingerprint probe")
            }
            catch(_){

            }
            return realBlob.apply(this,
            args)
          })
        }
        catch(_){

        }
        try{
          const ctxProto=CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype,
          realImageData=ctxProto&&ctxProto.getImageData;
          realImageData&&(ctxProto.getImageData=function(...args){
            try{
              noteFingerprint("Canvas readback probe")
            }
            catch(_){

            }
            return realImageData.apply(this,
            args)
          })
        }
        catch(_){

        }
        try{
          const patchGLProbe=proto=>{
            if(!proto||!proto.getParameter)return;
            const realGetParameter=proto.getParameter;
            proto.getParameter=function(p){
              try{
                37445!==p&&37446!==p||noteFingerprint("GPU fingerprint probe")
              }
              catch(_){

              }
              return realGetParameter.apply(this,
              arguments)
            }

          };
          patchGLProbe(window.WebGLRenderingContext&&WebGLRenderingContext.prototype),
          patchGLProbe(window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype)
        }
        catch(_){

        }
        try{
          if(navigator.geolocation){
            const geo=navigator.geolocation,
            realGeo=geo.getCurrentPosition&&geo.getCurrentPosition.bind(geo);
            realGeo&&(geo.getCurrentPosition=function(...args){
              return Date.now()-loadedAt<5e3&&!interacted&&addSignal(20,
              "Requested geolocation before interaction",
              "geo-no-click"),
              realGeo(...args)
            });
            const realWatch=geo.watchPosition&&geo.watchPosition.bind(geo);
            realWatch&&(geo.watchPosition=function(...args){
              return Date.now()-loadedAt<5e3&&!interacted&&addSignal(20,
              "Started geolocation tracking before interaction",
              "geo-watch-no-click"),
              realWatch(...args)
            })
          }

        }
        catch(_){

        }
        try{
          __woBackgroundRequest({
            kind:"domain-age",
            domain:fullHost
          },
          res=>{
            try{
              res&&res.ok&&"number"==typeof res.ageDays&&(res.ageDays>=180&&(establishedDomain=!0),
              res.ageDays<30?addSignal(30,
              "Domain registered very recently ("+res.ageDays+" days ago)",
              "new-domain"):res.ageDays<90&&addSignal(15,
              "Domain is fairly new",
              "young-domain"))
            }
            catch(_){

            }

          })
        }
        catch(_){

        }
        function maybeWarn(){
          const band=riskBand();
          if(establishedDomain&&band<2)return;
          !band||band<=lastWarnBand||(lastWarnBand=band,
          log("behavioral_risk",
          {
            host:here,
            score:score,
            level:riskLevel(),
            reasons:reasons.slice(0,
            10)
          }))
        }
        setTimeout(maybeWarn,
        4500)
      }

    }
    catch(e){
      log("behavioral_scan_failed",
      {
        error:String(e)
      })
    }
    if(!1!==WO.detectPhishing&&(fn=>{
      try{
        if("function"==typeof window.requestIdleCallback)return window.requestIdleCallback(fn,
        {
          timeout:250
        })
      }
      catch(_){

      }
      window.setTimeout(fn,
      250)
    })(()=>{
      const BRANDS={
        paypal:["paypal.com",
        "paypal.me",
        "paypalobjects.com"],
        google:["google.com",
        "google.co.uk",
        "g.co",
        "goo.gle",
        "withgoogle.com",
        "googleblog.com",
        "googleapis.com",
        "gstatic.com",
        "googleusercontent.com",
        "googlemail.com",
        "youtube.com",
        "gmail.com"],
        amazon:["amazon.com",
        "amazon.co.uk",
        "amazon.ca",
        "amazon.de",
        "amazon.in",
        "amazon.co.jp",
        "amazon.com.au",
        "amazon.fr",
        "amazon.it",
        "amazon.es",
        "amzn.com",
        "amazonpay.com",
        "amzn.to"],
        apple:["apple.com",
        "icloud.com",
        "me.com"],
        microsoft:["microsoft.com",
        "microsoft365.com",
        "live.com",
        "outlook.com",
        "office.com",
        "office365.com",
        "microsoftonline.com",
        "sharepoint.com",
        "onmicrosoft.com",
        "msftauth.net",
        "msauth.net",
        "azure.com",
        "azureedge.net",
        "aka.ms"],
        facebook:["facebook.com",
        "fb.com",
        "fb.me",
        "messenger.com",
        "meta.com",
        "facebookmail.com",
        "fbcdn.net"],
        instagram:["instagram.com"],
        netflix:["netflix.com"],
        whatsapp:["whatsapp.com",
        "wa.me"],
        twitter:["twitter.com",
        "x.com",
        "t.co"],
        linkedin:["linkedin.com",
        "lnkd.in"],
        chase:["chase.com",
        "jpmorganchase.com"],
        wellsfargo:["wellsfargo.com"],
        bankofamerica:["bankofamerica.com",
        "bofa.com"],
        citibank:["citibank.com",
        "citi.com"],
        capitalone:["capitalone.com"],
        barclays:["barclays.co.uk",
        "barclays.com"],
        hsbc:["hsbc.com",
        "hsbc.co.uk"],
        santander:["santander.com",
        "santander.co.uk"],
        coinbase:["coinbase.com"],
        binance:["binance.com",
        "binance.us"],
        kraken:["kraken.com"],
        metamask:["metamask.io"],
        blockchain:["blockchain.com"],
        steam:["steampowered.com",
        "steamcommunity.com"],
        discord:["discord.com",
        "discord.gg",
        "discordapp.com"],
        roblox:["roblox.com"],
        epicgames:["epicgames.com"],
        dropbox:["dropbox.com",
        "dropboxusercontent.com"],
        ebay:["ebay.com",
        "ebay.co.uk"],
        spotify:["spotify.com"],
        yahoo:["yahoo.com"],
        proton:["proton.me",
        "protonmail.com"],
        usps:["usps.com"],
        fedex:["fedex.com"],
        dhl:["dhl.com"],
        ups:["ups.com"],
        royalmail:["royalmail.com"],
        irs:["irs.gov"],
        hmrc:["gov.uk"],
        walmart:["walmart.com"],
        target:["target.com"],
        wise:["wise.com"],
        venmo:["venmo.com"],
        cashapp:["cash.app"],
        zelle:["zellepay.com"],
        docusign:["docusign.com",
        "docusign.net"],
        adobe:["adobe.com"],
        gemini:["gemini.com"],
        crypto:["crypto.com"],
        trezor:["trezor.io"],
        ledger:["ledger.com"],
        exodus:["exodus.com"],
        revolut:["revolut.com"],
        monzo:["monzo.com"],
        natwest:["natwest.com"],
        lloyds:["lloydsbank.com"],
        halifax:["halifax.co.uk"],
        nationwide:["nationwide.co.uk"],
        tsb:["tsb.co.uk"],
        americanexpress:["americanexpress.com",
        "aexp.com"],
        amex:["americanexpress.com"],
        mastercard:["mastercard.com"],
        visa:["visa.com"],
        stripe:["stripe.com"],
        square:["squareup.com"],
        github:["github.com",
        "githubusercontent.com",
        "githubassets.com",
        "github.io"],
        gitlab:["gitlab.com"],
        twitch:["twitch.tv",
        "ttvnw.net",
        "jtvnw.net",
        "twitchcdn.net"],
        tiktok:["tiktok.com"],
        snapchat:["snapchat.com"],
        telegram:["telegram.org",
        "t.me"],
        signal:["signal.org"],
        reddit:["reddit.com"],
        pinterest:["pinterest.com"],
        tumblr:["tumblr.com"],
        twitch_tv:["twitch.tv",
        "ttvnw.net",
        "jtvnw.net",
        "twitchcdn.net"],
        booking:["booking.com"],
        airbnb:["airbnb.com"],
        uber:["uber.com"],
        lyft:["lyft.com"],
        doordash:["doordash.com"],
        instacart:["instacart.com"],
        costco:["costco.com"],
        bestbuy:["bestbuy.com"],
        aliexpress:["aliexpress.com"],
        alibaba:["alibaba.com"],
        shopify:["shopify.com"],
        etsy:["etsy.com"],
        samsung:["samsung.com"],
        sony:["sony.com"],
        nintendo:["nintendo.com"],
        playstation:["playstation.com"],
        xbox:["xbox.com"],
        evri:["evri.com"],
        dpd:["dpd.co.uk",
        "dpd.com"],
        usbank:["usbank.com"],
        pnc:["pnc.com"],
        tdbank:["td.com"],
        truist:["truist.com"]
      };
      try{
        const cb=WO.customBrands||{

        };
        for(const k of Object.keys(cb)){
          const key=String(k).toLowerCase().replace(/[^a-z0-9]/g,
          "");
          key&&Array.isArray(cb[k])&&(BRANDS[key]=cb[k].map(d=>String(d).toLowerCase()))
        }

      }
      catch{

      }
      const here=(location.hostname||"").replace(/^www\./,
      "").toLowerCase(),
      parts=here.split("."),
      sld=parts.length>=2?parts[parts.length-2]:here,
      fullHost=here,
      visualNorm=s=>s.replace(/rn/g,
      "m").replace(/vv/g,
      "w").replace(/0/g,
      "o").replace(/1/g,
      "l").replace(/3/g,
      "e").replace(/5/g,
      "s").replace(/7/g,
      "t").replace(/8/g,
      "b").replace(/\$/g,
      "s").replace(/@/g,
      "a").replace(/!/g,
      "i"),
      lev=(a,
      b)=>{
        const m=a.length,
        n=b.length;
        if(Math.abs(m-n)>2)return 99;
        const dp=Array.from({
          length:m+1
        },
        (_,
        i)=>[i,
        ...Array(n).fill(0)]);
        for(let j=0;
        j<=n;
        j++)dp[0][j]=j;
        for(let i=1;
        i<=m;
        i++)for(let j=1;
        j<=n;
        j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],
        dp[i][j-1],
        dp[i-1][j-1]);
        return dp[m][n]
      },
      KB={
        q:"wa",
        w:"qeas",
        e:"wrsd",
        r:"etdf",
        t:"rygf",
        y:"tuhg",
        u:"yijh",
        i:"uojk",
        o:"ipkl",
        p:"ol",
        a:"qwsz",
        s:"awedxz",
        d:"serfcx",
        f:"drtgvc",
        g:"ftyhbv",
        h:"gyujnb",
        j:"huiknm",
        k:"jiolm",
        l:"kop",
        z:"asx",
        x:"zsdc",
        c:"xdfv",
        v:"cfgb",
        b:"vghn",
        n:"bhjm",
        m:"njk"
      },
      isKbAdjacent=(a,
      b)=>KB[a]&&KB[a].includes(b)||KB[b]&&KB[b].includes(a),
      subIsKbTypo=(cand,
      brand)=>{
        if(cand.length!==brand.length)return!1;
        let diffs=0,
        adj=!1;
        for(let i=0;
        i<cand.length;
        i++)if(cand[i]!==brand[i]&&(diffs++,
        adj=isKbAdjacent(cand[i],
        brand[i])),
        diffs>1)return!1;
        return 1===diffs&&adj
      },
      isTyposquat=(cand,
      brand)=>{
        if(cand===brand)return!1;
        const nc=visualNorm(cand),
        nb=visualNorm(brand);
        if(nc===nb)return!0;
        if(cand.length===brand.length&&1===lev(cand,
        brand))return!0;
        if(nc.length===nb.length&&1===lev(nc,
        nb))return!0;
        if(brand.length>=5&&1===Math.abs(cand.length-brand.length)){
          const longer=cand.length>brand.length?cand:brand,
          shorter=cand.length>brand.length?brand:cand,
          isPlainSuffix=longer.startsWith(shorter);
          if(!isPlainSuffix&&1===lev(cand,
          brand))return!0;
          if(!isPlainSuffix&&1===Math.abs(nc.length-nb.length)&&1===lev(nc,
          nb))return!0;
          if(isPlainSuffix&&longer.length>=2&&longer[longer.length-1]===longer[longer.length-2])return!0
        }
        return!1
      },
      isLegit=brand=>(BRANDS[brand]||[]).some(d=>fullHost===d||fullHost.endsWith("."+d)),
      COMMON_WORD_BRANDS=new Set(["apple",
      "target",
      "visa",
      "square",
      "wise",
      "ups",
      "chase",
      "signal",
      "gemini",
      "crypto",
      "discord",
      "steam",
      "sony",
      "uber",
      "amex",
      "irs",
      "hmrc",
      "dpd",
      "pnc"]);
      let phishHit=null;
      const isPuny=/(^|\.)xn--/i.test(here),
      hasPhishWord=/(login|signin|sign-in|secure|security|verify|verification|account|update|confirm|wallet|recovery|unlock|suspended)/.test(here);
      if(!/^(steamdb|appleinsider|9to5google|9to5mac|amazonaws|googleapis|googleusercontent|gstatic|applemusic|paypalobjects|fbcdn|akamai|cloudfront)/.test(sld))for(const brand of Object.keys(BRANDS)){
        if(isLegit(brand)){
          phishHit=null;
          break
        }
        if(isTyposquat(sld,
        brand)){
          const hi=visualNorm(sld)===visualNorm(brand)||subIsKbTypo(sld,
          brand);
          phishHit={
            brand:brand,
            kind:"typosquat",
            confidence:hi?"high":"medium"
          }

        }
        else sld!==brand||isLegit(brand)||COMMON_WORD_BRANDS.has(brand)?parts.includes(brand)&&sld!==brand&&!isLegit(brand)?phishHit={
          brand:brand,
          kind:"subdomain-spoof",
          confidence:"high"
        }
        :sld!==brand&&sld.includes(brand)&&sld.length<=brand.length+20&&hasPhishWord&&(phishHit={
          brand:brand,
          kind:"brand-in-name",
          confidence:"medium"
        }):phishHit={
          brand:brand,
          kind:"tld-swap",
          confidence:"high"
        };
        if(phishHit)break
      }
      if(phishHit&&isPuny&&(phishHit.kind="homograph",
      phishHit.confidence="high"),
      phishHit){
        try{
          WO.__pageRisk={
            phishing:!0,
            brand:phishHit.brand,
            kind:phishHit.kind,
            confidence:phishHit.confidence
          }

        }
        catch(_){

        }
        if(log("warned_phishing",
        {
          matched:fullHost,
          brand:phishHit.brand,
          kind:phishHit.kind,
          confidence:phishHit.confidence
        }),
        WO.blockHighConfidencePhishing&&"high"===phishHit.confidence)return log("blocked_phishing",
        {
          matched:fullHost,
          brand:phishHit.brand,
          kind:phishHit.kind
        }),
        void((hit,
        brands)=>{
          const legit=(brands[hit.brand]||[])[0]||hit.brand+".com",
          KT={
            typosquat:"is a look-alike of",
            "tld-swap":"uses the exact name of",
            "subdomain-spoof":"puts the name of",
            "brand-in-name":"uses the name of",
            homograph:"uses look-alike characters to imitate"
          };
          let teardown=null;
          teardown=mountBlocker("rg-phish-block",
          ()=>{
            const host=buildOverlay("rg-phish-block",
            "#450a0a"),
            card=oDiv(host,
            "background:#1a0d0d!important;color:#fee2e2!important;max-width:540px!important;width:100%!important;border:1px solid #7f1d1d!important;border-radius:14px!important;padding:28px!important;box-shadow:0 20px 60px rgba(0,0,0,.6)!important;font-family:system-ui,sans-serif!important;");
            oDiv(card,
            "font-size:13px!important;font-weight:700!important;color:#fca5a5!important;text-transform:uppercase!important;letter-spacing:.05em!important;margin:0 0 8px 0!important;",
            "Likely phishing site blocked"),
            oDiv(card,
            "font-size:19px!important;font-weight:700!important;color:#fff!important;margin:0 0 12px 0!important;line-height:1.35!important;",
            "This site "+(KT[hit.kind]||"imitates")+" "+hit.brand),
            oDiv(card,
            "color:#fecaca!important;margin:0 0 16px 0!important;font-size:13.5px!important;line-height:1.55!important;",
            "The address looks like a fake version of a well-known brand. Sites like this are used to steal passwords and payment details. Do not enter any login or personal information here.");
            const ROW="background:#2a1212!important;border:1px solid #7f1d1d!important;border-radius:8px!important;padding:10px 12px!important;margin:6px 0!important;word-break:break-all!important;font-family:ui-monospace,monospace!important;font-size:12.5px!important;",
            LBL="color:#f87171!important;font-size:11px!important;text-transform:uppercase!important;letter-spacing:.04em!important;margin:10px 0 3px 0!important;";
            oDiv(card,
            LBL,
            "You are on"),
            oTextDiv(card,
            ROW+"color:#fecaca!important;",
            String(location.hostname).slice(0,
            200)),
            oDiv(card,
            LBL,
            "The real site is"),
            oTextDiv(card,
            ROW+"color:#86efac!important;border-color:#166534!important;background:#0d1a0d!important;",
            legit);
            const btns=oDiv(card,
            "display:flex!important;gap:10px!important;margin-top:20px!important;flex-wrap:wrap!important;");
            oBtn(btns,
            "background:#16a34a!important;color:#fff!important;border-radius:8px!important;padding:11px 18px!important;font-size:13.5px!important;font-weight:700!important;font-family:system-ui,sans-serif!important;",
            "Go to the real "+hit.brand,
            ()=>{
              teardown&&teardown();
              try{
                location.href="https://"+legit
              }
              catch(_){

              }

            }),
            oBtn(btns,
            "background:#7f1d1d!important;color:#fecaca!important;border-radius:8px!important;padding:11px 18px!important;font-size:13.5px!important;font-family:system-ui,sans-serif!important;",
            "<- Go back",
            ()=>{
              teardown&&teardown(),
              realGoBack()
            }),
            oBtn(btns,
            "background:transparent!important;color:#9a6565!important;border:1px solid #5a2a2a!important;border-radius:8px!important;padding:11px 14px!important;font-size:12px!important;font-family:system-ui,sans-serif!important;",
            "I understand the risk, continue",
            ()=>{
              teardown&&teardown()
            }),
            document.documentElement.appendChild(host)
          })
        })(phishHit,
        BRANDS);
        const KIND_TEXT={
          typosquat:"is a look-alike of",
          "tld-swap":"uses the exact name of",
          "subdomain-spoof":"puts the name of",
          "brand-in-name":"uses the name of",
          homograph:"uses look-alike characters to imitate"
        },
        showPhishBar=()=>{
          if(!document.documentElement||document.getElementById("rg-phish-bar"))return;
          const bar=document.createElement("div");
          bar.id="rg-phish-bar",
          S(bar,
          "all:initial!important;position:fixed!important;top:0!important;left:0!important;right:0!important;width:100%!important;z-index:2147483646!important;background:#7f1d1d!important;color:#fff!important;font-family:system-ui,sans-serif!important;font-size:13px!important;padding:10px 14px!important;box-sizing:border-box!important;display:flex!important;align-items:center!important;gap:12px!important;box-shadow:0 4px 16px rgba(0,0,0,.4)!important;");
          const txt=document.createElement("div");
          S(txt,
          "flex:1!important;line-height:1.4!important;color:#fff!important;");
          const title=document.createElement("b");
          title.textContent="Possible phishing site.";
          const hostName=document.createElement("b");
          hostName.textContent=fullHost;
          const brand=document.createElement("b");
          brand.textContent=phishHit.brand,
          txt.appendChild(title),
          txt.append(" This domain ("),
          txt.appendChild(hostName),
          txt.append(") "+(KIND_TEXT[phishHit.kind]||"imitates")+" "),
          txt.appendChild(brand),
          txt.append(". Check the address carefully before entering any password or payment details."),
          bar.appendChild(txt);
          const x=document.createElement("button");
          S(x,
          "all:unset!important;cursor:pointer!important;color:#fca5a5!important;font-size:18px!important;padding:0 4px!important;flex:none!important;"),
          x.textContent="x",
          x.addEventListener("click",
          ()=>bar.remove()),
          bar.appendChild(x),
          document.documentElement.appendChild(bar)
        };
        document.documentElement?showPhishBar():document.addEventListener("DOMContentLoaded",
        showPhishBar)
      }

    }),
    WO.warnGrabberDomains&&Array.isArray(WO.grabberDomains)){
      const host=(location.hostname||"").replace(/^www\./,
      "").toLowerCase(),
      hit=WO.grabberDomains.find(d=>host===d||host.endsWith("."+d));
      if(hit){
        WO.__frozen=!0,
        document.querySelectorAll('meta[http-equiv="refresh" i]').forEach(m=>{
          m.setAttribute("data-wo-disabled",
          m.getAttribute("content")||""),
          m.removeAttribute("content")
        }),
        log("detected_grabber_domain",
        {
          host:host,
          matched:hit
        });
        let teardown=null;
        const paint=()=>{
          const ov=buildOverlay("rg-grabber-warn",
          "#1a0b0b"),
          card=oDiv(ov,
          "background:#211111!important;color:#f3e6e6!important;max-width:560px!important;width:100%!important;border:1px solid #3a2323!important;border-radius:14px!important;padding:28px!important;box-shadow:0 20px 60px rgba(0,0,0,.5)!important;font-family:system-ui,sans-serif!important;");
          oDiv(card,
          "font-size:18px!important;font-weight:700!important;color:#fff!important;margin:0 0 6px 0!important;",
          "Known IP-logger detected");
          const grabberMsg=oDiv(card,
          "color:#d0a7a7!important;margin:0 0 14px 0!important;font-size:13px!important;line-height:1.5!important;",
          "This domain (");
          appendBold(grabberMsg,
          hit),
          appendText(grabberMsg,
          ") is a known IP-grabber / logger service. These links exist to record the IP address of whoever clicks them."),
          oDiv(card,
          "background:#2a1414!important;border:1px solid #3a2323!important;border-radius:8px!important;padding:12px!important;font-size:12px!important;color:#e8c5c5!important;margin:10px 0!important;line-height:1.5!important;",
          "Be aware: simply by loading this page, your IP address has already been sent to this server  -  that is how any web request works, and no browser tool can undo it after the fact. To prevent this entirely, use a VPN so the logger only ever sees the VPN's address, or block these domains at the network/DNS level so the connection never happens."),
          oTextDiv(card,
          "background:#160b0b!important;border:1px solid #3a2323!important;border-radius:8px!important;padding:10px 12px!important;margin:8px 0!important;word-break:break-all!important;font-family:ui-monospace,monospace!important;font-size:12px!important;color:#e0cdcd!important;",
          String(location.href).slice(0,
          300));
          const btns=oDiv(card,
          "display:flex!important;gap:10px!important;margin-top:18px!important;flex-wrap:wrap!important;");
          oBtn(btns,
          "background:#dc2626!important;color:#fff!important;border-radius:8px!important;padding:10px 16px!important;font-size:13px!important;font-family:system-ui,sans-serif!important;",
          "<- Leave this page",
          ()=>{
            teardown&&teardown(),
            realGoBack()
          }),
          oBtn(btns,
          "background:#2a1f1f!important;color:#e0cdcd!important;border-radius:8px!important;padding:10px 16px!important;font-size:13px!important;font-family:system-ui,sans-serif!important;",
          "Dismiss",
          ()=>{
            teardown&&teardown()
          }),
          document.documentElement.appendChild(ov)
        };
        teardown=mountBlocker("rg-grabber-warn",
        paint)
      }

    }
    if(!1!==WO.sendPrivacySignals)try{
      const defprop=(obj,
      name,
      val)=>{
        try{
          Object.defineProperty(obj,
          name,
          {
            get:()=>val,
            configurable:!0,
            enumerable:!0
          })
        }
        catch(_){

        }

      };
      defprop(Navigator.prototype,
      "doNotTrack",
      "1");
      try{
        defprop(navigator,
        "doNotTrack",
        "1")
      }
      catch(_){

      }
      defprop(Navigator.prototype,
      "globalPrivacyControl",
      !0);
      try{
        defprop(navigator,
        "globalPrivacyControl",
        !0)
      }
      catch(_){

      }
      try{
        defprop(window,
        "doNotTrack",
        "1")
      }
      catch(_){

      }

    }
    catch(e){
      log("privacy_signal_failed",
      {
        error:String(e)
      })
    }
    if(WO.antiFingerprintNoise||WO.antiFingerprint)try{
      let _s=(()=>{
        try{
          const a=new Uint32Array(2);
          return crypto.getRandomValues(a),
          (a[0]^2654435761*a[1])>>>0
        }
        catch{
          return 4294967296*Math.random()>>>0
        }

      })();
      const __woCloak=new WeakMap;
      try{const _oFTS=Function.prototype.toString,_cFTS=function toString(){const n=__woCloak.get(this);return void 0!==n?"function "+n+"() { [native code] }":_oFTS.call(this)};__woCloak.set(_cFTS,"toString"),Function.prototype.toString=_cFTS}catch(_){}
      const _sk=_s>>>0,
      rnd=()=>(_s=1664525*_s+1013904223>>>0,
      _s/4294967296),
      tinyNoise=(scale=0.01)=>(rnd()-.5)*scale,
      mixSeed=str=>{let h=(_sk^2166136261)>>>0;str=String(str);for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619)>>>0;return h>>>0},
      makeRnd=seed=>{let s=(seed>>>0)||1;return()=>(s=1664525*s+1013904223>>>0,s/4294967296)},
      hashBytes=data=>{let h=(_sk^2166136261)>>>0,step=Math.max(1,data.length>>12);for(let i=0;i<data.length;i+=step)h=Math.imul(h^data[i],16777619)>>>0;return(h^data.length)>>>0},
      seededTiny=(key,scale=0.01)=>(makeRnd(mixSeed(key))()-.5)*scale,
      cloak=(fn,name)=>{try{__woCloak.set(fn,name)}catch(_){}return fn},
      noisify=canvas=>{
        try{
          const ctx=canvas.getContext&&canvas.getContext("2d");
          if(!ctx)return;
          const w=canvas.width,
          h=canvas.height;
          if(!w||!h||w*h>5e6)return;
          const img=ctx.getImageData(0,
          0,
          w,
          h),
          d=img.data,
          r=makeRnd(hashBytes(d)),
          tweaks=Math.max(8,
          Math.floor(w*h/4096));
          for(let i=0;
          i<tweaks;
          i++){
            const px=4*Math.floor(r()*(w*h));
            d[px]=d[px]^(r()<.5?1:0),
            d[px+1]=d[px+1]^(r()<.5?1:0),
            d[px+2]=d[px+2]^(r()<.5?1:0)
          }
          ctx.putImageData(img,
          0,
          0)
        }
        catch(_){

        }

      },
      noisyCanvasForRead=canvas=>{
        try{
          if(!canvas||!canvas.width||!canvas.height)return canvas;
          const copy=document.createElement("canvas");
          copy.width=canvas.width,
          copy.height=canvas.height;
          const ctx=copy.getContext&&copy.getContext("2d");
          return ctx&&(ctx.drawImage(canvas,
          0,
          0),
          noisify(copy)),
          copy
        }
        catch(_){
          return canvas
        }

      },
      origToDataURL=HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL=function(...args){
        return origToDataURL.apply(noisyCanvasForRead(this),
        args)
      };
      const origToBlob=HTMLCanvasElement.prototype.toBlob;
      origToBlob&&(HTMLCanvasElement.prototype.toBlob=function(cb,
      ...rest){
        return origToBlob.call(noisyCanvasForRead(this),
        cb,
        ...rest)
      });
      const origGetImageData=CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData=function(...args){
        const res=origGetImageData.apply(this,
        args);
        try{
          const d=res.data,
          r=makeRnd(hashBytes(d)),
          tweaks=Math.max(4,
          Math.floor(d.length/16384));
          for(let i=0;
          i<tweaks;
          i++){
            const idx=Math.floor(r()*d.length);
            d[idx]=d[idx]^(r()<.5?1:0)
          }

        }
        catch(_){

        }
        return res
      };
      try{
        const patchMeasureText=proto=>{
          if(!proto||!proto.measureText)return;
          const orig=proto.measureText;
          proto.measureText=function(...args){
            const metrics=orig.apply(this,
            args);
            try{
              const n=seededTiny((this.font||"")+"|"+String(args[0]||""),.02);
              return new Proxy(metrics,
              {
                get(target,
                prop){
                  const v=target[prop];
                  return"number"==typeof v&&/^(width|actualBoundingBox|fontBoundingBox|emHeight|hangingBaseline|alphabeticBaseline|ideographicBaseline)/.test(String(prop))?v+n:v
                }

              })
            }
            catch(_){
              return metrics
            }

          }

        };
        patchMeasureText(window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype),
        window.OffscreenCanvasRenderingContext2D&&patchMeasureText(OffscreenCanvasRenderingContext2D.prototype)
      }
      catch(_){

      }
      try{
        const wrapRect=r=>{
          try{
            if(!r)return r;
            const k=(r.x||r.left||0)+","+(r.y||r.top||0)+","+(r.width||0)+"x"+(r.height||0),
            x=seededTiny(k+"X",.04),
            y=seededTiny(k+"Y",.04),
            w=seededTiny(k+"W",.03),
            h=seededTiny(k+"H",.03);
            return new DOMRect((r.x||r.left||0)+x,
            (r.y||r.top||0)+y,
            Math.max(0,
            (r.width||0)+w),
            Math.max(0,
            (r.height||0)+h))
          }
          catch(_){
            return r
          }

        },
        patchRectProto=proto=>{
          if(!proto)return;
          if(proto.getBoundingClientRect){
            const origBox=proto.getBoundingClientRect;
            proto.getBoundingClientRect=function(...args){
              return wrapRect(origBox.apply(this,
              args))
            }

          }
          if(proto.getClientRects){
            const origList=proto.getClientRects;
            proto.getClientRects=function(...args){
              const list=origList.apply(this,
              args),
              out=Array.from(list||[]).map(wrapRect);
              return out.item=i=>out[i]||null,
              out
            }

          }

        };
        patchRectProto(window.Element&&Element.prototype),
        window.Range&&patchRectProto(Range.prototype)
      }
      catch(_){

      }
      try{
        const patchSvgText=proto=>{
          if(!proto)return;
          ["getComputedTextLength",
          "getSubStringLength"].forEach(name=>{
            const orig=proto[name];
            orig&&(proto[name]=function(...args){
              const v=orig.apply(this,
              args);
              return"number"==typeof v?v+seededTiny((this.textContent||"")+name,.02):v
            })
          })
        };
        window.SVGTextContentElement&&patchSvgText(SVGTextContentElement.prototype)
      }
      catch(_){

      }
      /* Per-session plausible hardware profile instead of constant values, so a fixed "4 cores plus one GPU string" stops being a WardenOne tell. Seeded from the same per-load key as the canvas noise: cores, RAM and GPU vendor+renderer agree within a page but differ each load and across users. */
      const woPick=(arr,key)=>arr[Math.floor(makeRnd(mixSeed(key))()*arr.length)%arr.length];
      const woCores=woPick([4,8,8,12,16],"hwc"),
      woMem=woPick([4,8,8],"devmem"),
      woGpu=woPick([
        {v:"Google Inc. (Intel)",r:"ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)"},
        {v:"Google Inc. (Intel)",r:"ANGLE (Intel, Intel(R) HD Graphics 630 (0x0000591B) Direct3D11 vs_5_0 ps_5_0, D3D11)"},
        {v:"Google Inc. (NVIDIA)",r:"ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)"},
        {v:"Google Inc. (NVIDIA)",r:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"},
        {v:"Google Inc. (AMD)",r:"ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)"}
      ],"gpu");
      const patchGL=proto=>{
        if(!proto||!proto.getParameter)return;
        const orig=proto.getParameter;
        proto.getParameter=function(p){
          return 37445===p?woGpu.v:37446===p?woGpu.r:orig.call(this,
          p)
        };
        try{
          const getExt=proto.getExtension;
          getExt&&(proto.getExtension=function(name){
            return/^WEBGL_debug_renderer_info$/i.test(String(name||""))?null:getExt.apply(this,
            arguments)
          })
        }
        catch(_){

        }
        try{
          const getSupported=proto.getSupportedExtensions;
          getSupported&&(proto.getSupportedExtensions=function(){
            const out=getSupported.apply(this,
            arguments);
            return Array.isArray(out)?out.filter(x=>!/^WEBGL_debug_renderer_info$/i.test(String(x||""))):out
          })
        }
        catch(_){

        }

      };
      if(window.WebGLRenderingContext&&patchGL(WebGLRenderingContext.prototype),
      window.WebGL2RenderingContext&&patchGL(WebGL2RenderingContext.prototype),
      window.AnalyserNode){
        const af=AnalyserNode.prototype.getFloatFrequencyData;
        af&&(AnalyserNode.prototype.getFloatFrequencyData=function(arr){
          af.call(this,
          arr);
          try{
            for(let i=0;
            i<arr.length;
            i+=64)arr[i]=arr[i]+8e-4*(rnd()-.5)
          }
          catch(_){

          }

        })
      }
      try{
        if(window.OffscreenCanvas){
          const ocb=OffscreenCanvas.prototype.convertToBlob;
          ocb&&(OffscreenCanvas.prototype.convertToBlob=function(...a){
            return noisify(this),
            ocb.apply(this,
            a)
          })
        }

      }
      catch(_){

      }
      try{
        if(window.OffscreenCanvasRenderingContext2D){
          const ogid=OffscreenCanvasRenderingContext2D.prototype.getImageData;
          ogid&&(OffscreenCanvasRenderingContext2D.prototype.getImageData=function(...a){
            const res=ogid.apply(this,
            a);
            try{
              const d=res.data,
              r=makeRnd(hashBytes(d)),
              tw=Math.max(4,
              Math.floor(d.length/16384));
              for(let i=0;
              i<tw;
              i++){
                const idx=Math.floor(r()*d.length);
                d[idx]=d[idx]^(r()<.5?1:0)
              }

            }
            catch(_){

            }
            return res
          })
        }

      }
      catch(_){

      }
      try{
        if(window.AudioBuffer){
          const ogcd=AudioBuffer.prototype.getChannelData,
          _farb=new WeakSet;
          ogcd&&(AudioBuffer.prototype.getChannelData=function(...a){
            const arr=ogcd.apply(this,
            a);
            try{
              if(arr&&!_farb.has(arr)){
                _farb.add(arr);
                for(let i=0;
                i<arr.length;
                i+=100)arr[i]=arr[i]+1e-7*(rnd()-.5)
              }

            }
            catch(_){

            }
            return arr
          })
        }

      }
      catch(_){

      }
      try{[
        [HTMLCanvasElement.prototype,"toDataURL"],
        [HTMLCanvasElement.prototype,"toBlob"],
        [CanvasRenderingContext2D.prototype,"getImageData"],
        [CanvasRenderingContext2D.prototype,"measureText"],
        [Element.prototype,"getBoundingClientRect"],
        [Element.prototype,"getClientRects"],
        window.Range&&[Range.prototype,"getBoundingClientRect"],
        window.Range&&[Range.prototype,"getClientRects"],
        window.WebGLRenderingContext&&[WebGLRenderingContext.prototype,"getParameter"],
        window.WebGL2RenderingContext&&[WebGL2RenderingContext.prototype,"getParameter"],
        window.OffscreenCanvasRenderingContext2D&&[OffscreenCanvasRenderingContext2D.prototype,"getImageData"],
        window.AudioBuffer&&[AudioBuffer.prototype,"getChannelData"],
        window.AnalyserNode&&[AnalyserNode.prototype,"getFloatFrequencyData"]
      ].forEach(p=>{try{p&&p[0]&&"function"==typeof p[0][p[1]]&&cloak(p[0][p[1]],p[1])}catch(_){}})}catch(_){}
      const defp=(obj,
      name,
      val)=>{
        try{
          const g=cloak(function(){return val},"get "+name);
          Object.defineProperty(obj,
          name,
          {
            get:g,
            configurable:!0
          })
        }
        catch(_){

        }

      };
      defp(Navigator.prototype,
      "hardwareConcurrency",
      woCores),
      defp(Navigator.prototype,
      "deviceMemory",
      woMem),
      defp(Navigator.prototype,
      "maxTouchPoints",
      0);
      try{
        const emptyList=Object.freeze([]),
        screenW=Math.max(800,
        100*Math.round((screen.width||innerWidth||1200)/100)),
        screenH=Math.max(600,
        100*Math.round((screen.height||innerHeight||800)/100));
        defp(Navigator.prototype,
        "plugins",
        emptyList),
        defp(Navigator.prototype,
        "mimeTypes",
        emptyList),
        window.Screen&&(defp(Screen.prototype,
        "width",
        screenW),
        defp(Screen.prototype,
        "height",
        screenH),
        defp(Screen.prototype,
        "availWidth",
        screenW),
        defp(Screen.prototype,
        "availHeight",
        screenH),
        defp(Screen.prototype,
        "colorDepth",
        24),
        defp(Screen.prototype,
        "pixelDepth",
        24))
      }
      catch(_){

      }
      try{
        if(navigator.userAgentData){
          const uaProto=Object.getPrototypeOf(navigator.userAgentData),
          origHigh=uaProto&&uaProto.getHighEntropyValues;
          origHigh&&(uaProto.getHighEntropyValues=function(hints){
            return Promise.resolve(origHigh.call(this,
            hints)).then(res=>{
              const out=Object.assign({

              },
              res||{

              }),
              major=String((out.uaFullVersion||navigator.userAgent.match(/(?:Chrome|Chromium|Edg|Brave)\/(\d+)/)&&navigator.userAgent.match(/(?:Chrome|Chromium|Edg|Brave)\/(\d+)/)[1]||"120")).split(".")[0];
              return"architecture"in out&&(out.architecture=""),
              "bitness"in out&&(out.bitness=""),
              "model"in out&&(out.model=""),
              "platformVersion"in out&&(out.platformVersion=""),
              "uaFullVersion"in out&&(out.uaFullVersion=major+".0.0.0"),
              Array.isArray(out.fullVersionList)&&(out.fullVersionList=out.fullVersionList.map(b=>({
                brand:String(b.brand||"Chromium"),
                version:String(b.version||major).split(".")[0]+".0.0.0"
              }))),
              out
            })
          })
        }

      }
      catch(_){

      }
      try{
        const conn={
          downlink:10,
          effectiveType:"4g",
          rtt:50,
          saveData:!1,
          onchange:null,
          addEventListener:()=>{

          },
          removeEventListener:()=>{

          },
          dispatchEvent:()=>!0
        };
        defp(Navigator.prototype,
        "connection",
        conn),
        defp(Navigator.prototype,
        "mozConnection",
        conn),
        defp(Navigator.prototype,
        "webkitConnection",
        conn)
      }
      catch(_){

      }
      try{
        if(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices){
          const origEnum=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
          navigator.mediaDevices.enumerateDevices=function(){
            return Promise.resolve(origEnum()).then(list=>(list||[]).map((d,
            i)=>({
              kind:String(d&&d.kind||""),
              label:"",
              deviceId:String(d&&d.kind||"device")+"-"+i,
              groupId:"",
              toJSON(){
                return{
                  kind:this.kind,
                  label:this.label,
                  deviceId:this.deviceId,
                  groupId:this.groupId
                }

              }

            })))
          }

        }

      }
      catch(_){

      }
      try{
        if(Navigator.prototype.getBattery)Navigator.prototype.getBattery=function(){
          return Promise.resolve({
            charging:!0,
            chargingTime:0,
            dischargingTime:1/0,
            level:1,
            onchange:null,
            onchargingchange:null,
            onchargingtimechange:null,
            ondischargingtimechange:null,
            onlevelchange:null,
            addEventListener:()=>{

            },
            removeEventListener:()=>{

            },
            dispatchEvent:()=>!0
          })
        }

      }
      catch(_){

      }
      try{
        window.AudioContext&&defp(AudioContext.prototype,
        "sampleRate",
        48000),
        window.webkitAudioContext&&defp(webkitAudioContext.prototype,
        "sampleRate",
        48000)
      }
      catch(_){

      }
      log("antifingerprint_active",
      {

      })
    }
    catch(e){
      log("antifingerprint_failed",
      {
        error:String(e)
      })
    }
    if(WO.blockWebRTCLeak)try{
      const IP_LOOKUP_HOST_RE=/(^|\.)(api\.ipify\.org|api64\.ipify\.org|ipify\.org|ipinfo\.io|ifconfig\.me|icanhazip\.com|ident\.me|checkip\.amazonaws\.com|ip-api\.com|ipapi\.co|ipwho\.is|myexternalip\.com|wtfismyip\.com|ipecho\.net|jsonip\.com|seeip\.org|ip2location\.io|ipdata\.co|db-ip\.com)$/i,
      ipLookupUrl=input=>{
        try{
          const raw="string"==typeof input?input:input&&input.url?input.url:String(input||""),
          u=new URL(raw,
          location.href);
          return/^(https?|wss?):$/i.test(u.protocol)&&IP_LOOKUP_HOST_RE.test(u.hostname)&&!IP_LOOKUP_HOST_RE.test(location.hostname)?u.href:null
        }
        catch(_){
          return null
        }

      };
      let ipLookupBlockCount=0;
      const noteIpLookup=url=>{
        ++ipLookupBlockCount<=50&&log("blocked_ip_lookup",
        {
          matched:url,
          why:"Blocked a page script from asking a third-party IP echo service for your address."
        })
      },
      blockedIpLookupResponse=url=>{
        noteIpLookup(url);
        try{
          return Promise.resolve(new Response("",
          {
            status:403,
            statusText:"Blocked by WardenOne"
          }))
        }
        catch(_){
          return Promise.reject(new DOMException("IP lookup blocked by WardenOne",
          "SecurityError"))
        }

      };
      if(window.fetch){
        const realFetch=window.fetch;
        realFetch.__wardenoneIpPrivacy||(window.fetch=function(input,
        init){
          const hit=ipLookupUrl(input);
          return hit?blockedIpLookupResponse(hit):realFetch.apply(this,
          arguments)
        },
        Object.defineProperty(window.fetch,
        "__wardenoneIpPrivacy",
        {
          value:!0
        }))
      }
      if(navigator.sendBeacon){
        const realBeacon=navigator.sendBeacon.bind(navigator);
        realBeacon.__wardenoneIpPrivacy||(navigator.sendBeacon=function(url,
        data){
          const hit=ipLookupUrl(url);
          return hit?(noteIpLookup(hit),
          !0):realBeacon(url,
          data)
        },
        Object.defineProperty(navigator.sendBeacon,
        "__wardenoneIpPrivacy",
        {
          value:!0
        }))
      }
      if(window.XMLHttpRequest){
        const RX=window.XMLHttpRequest,
        realOpen=RX.prototype.open,
        realSend=RX.prototype.send;
        realOpen.__wardenoneIpPrivacy||(RX.prototype.open=function(method,
        url,
        ...rest){
          this.__wo_ip_lookup_url=ipLookupUrl(url);
          return realOpen.call(this,
          method,
          url,
          ...rest)
        },
        Object.defineProperty(RX.prototype.open,
        "__wardenoneIpPrivacy",
        {
          value:!0
        }));
        realSend.__wardenoneIpPrivacy||(RX.prototype.send=function(...args){
          if(!this.__wo_ip_lookup_url)return realSend.apply(this,
          args);
          noteIpLookup(this.__wo_ip_lookup_url);
          try{
            this.abort()
          }
          catch(_){

          }

        },
        Object.defineProperty(RX.prototype.send,
        "__wardenoneIpPrivacy",
        {
          value:!0
        }))
      }
      if(window.WebSocket){
        const RealWS=window.WebSocket;
        RealWS.__wardenoneIpPrivacy||(window.WebSocket=function(url,
        protocols){
          const hit=ipLookupUrl(url);
          if(hit)throw noteIpLookup(hit),
          new DOMException("IP lookup socket blocked by WardenOne",
          "SecurityError");
          return new RealWS(url,
          protocols)
        },
        window.WebSocket.prototype=RealWS.prototype,
        Object.setPrototypeOf&&Object.setPrototypeOf(window.WebSocket,
        RealWS),
        Object.defineProperty(window.WebSocket,
        "__wardenoneIpPrivacy",
        {
          value:!0
        }))
      }
      if(window.EventSource){
        const RealES=window.EventSource;
        RealES.__wardenoneIpPrivacy||(window.EventSource=function(url,
        config){
          const hit=ipLookupUrl(url);
          if(hit)throw noteIpLookup(hit),
          new DOMException("IP lookup stream blocked by WardenOne",
          "SecurityError");
          return new RealES(url,
          config)
        },
        window.EventSource.prototype=RealES.prototype,
        Object.setPrototypeOf&&Object.setPrototypeOf(window.EventSource,
        RealES),
        Object.defineProperty(window.EventSource,
        "__wardenoneIpPrivacy",
        {
          value:!0
        }))
      }
      log("ip_privacy_guard_active",
      {

      })
    }
    catch(e){
      log("ip_privacy_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.blockWebRTCLeak&&!trustedMediaHost&&WO.blockSuspiciousWebRTC)try{
      const RTC=window.RTCPeerConnection||window.webkitRTCPeerConnection||window.mozRTCPeerConnection;
      if(RTC){
        const Patched=function(cfg,
        constraints){
          cfg&&cfg.iceServers&&(cfg=Object.assign({

          },
          cfg,
          {
            iceServers:[]
          }));
          const pc=new RTC(cfg,
          constraints);
          try{
            Object.defineProperty(pc,
            "onicecandidate",
            {
              configurable:!0,
              enumerable:!0,
              get:()=>null,
              set(){

              }

            })
          }
          catch{

          }
          const realAdd=pc.addEventListener.bind(pc);
          let blockedIceListenerLogged=!1;
          pc.addEventListener=function(type,
          listener,
          opts){
            if("icecandidate"!==type)return realAdd(type,
            listener,
            opts);
            blockedIceListenerLogged||(blockedIceListenerLogged=!0,
            log("blocked_webrtc_candidate_listener",
            {

            }))
          };
          const scrubSdp=sdp=>sdp.replace(/^a=candidate:.*(\r\n|\n)/gim,
          "").replace(/^c=IN IP4 .*(\r\n|\n)/gim,
          "c=IN IP4 0.0.0.0\r\n").replace(/^c=IN IP6 .*(\r\n|\n)/gim,
          "c=IN IP6 ::\r\n").replace(/^o=(\S+) (\S+) (\S+) IN IP4 \S+/gim,
          "o=$1 $2 $3 IN IP4 0.0.0.0").replace(/^o=(\S+) (\S+) (\S+) IN IP6 \S+/gim,
          "o=$1 $2 $3 IN IP6 ::"),
          scrubCandidateText=text=>String(text||"").replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
          "0.0.0.0").replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi,
          "::"),
          scrubDesc=desc=>{
            try{
              return desc&&desc.sdp?Object.assign({

              },
              desc,
              {
                sdp:scrubSdp(desc.sdp)
              }):desc
            }
            catch(_){
              return desc
            }

          },
          patchDescProducer=name=>{
            try{
              const real=pc[name]&&pc[name].bind(pc);
              if(!real)return;
              pc[name]=function(...args){
                try{
                  "function"==typeof args[0]&&(args[0]=(ok=>desc=>ok(scrubDesc(desc)))(args[0]))
                }
                catch(_){

                }
                const ret=real(...args);
                return ret&&ret.then?ret.then(scrubDesc):scrubDesc(ret)
              }
            }
            catch(_){

            }

          },
          scrubStatsReport=report=>{
            try{
              if(!report||"function"!=typeof report.forEach)return report;
              const out=new Map;
              report.forEach((value,
              key)=>{
                try{
                  const clean=Object.assign({

                  },
                  value);
                  ["address",
                  "ip",
                  "ipAddress",
                  "relatedAddress",
                  "networkType"].forEach(k=>{
                    k in clean&&(clean[k]="")
                  }),
                  "candidate"in clean&&(clean.candidate=scrubCandidateText(clean.candidate)),
                  "url"in clean&&/^stun:|^turns?:/i.test(String(clean.url||""))&&(clean.url=""),
                  "candidateType"in clean&&(clean.candidateType="relay"),
                  out.set(key,
                  clean)
                }
                catch(_){
                  out.set(key,
                  value)
                }

              });
              return out
            }
            catch(_){
              return report
            }

          },
          realSetLocal=pc.setLocalDescription.bind(pc);
          patchDescProducer("createOffer"),
          patchDescProducer("createAnswer");
          try{
            if(pc.setConfiguration){
              const realSetConfig=pc.setConfiguration.bind(pc);
              pc.setConfiguration=function(config){
                try{
                  config&&config.iceServers&&(config=Object.assign({

                  },
                  config,
                  {
                    iceServers:[]
                  }))
                }
                catch(_){

                }
                return realSetConfig(config)
              }
            }

          }
          catch(_){

          }
          try{
            if(pc.getStats){
              const realStats=pc.getStats.bind(pc);
              pc.getStats=function(...args){
                const ret=realStats(...args);
                return ret&&ret.then?ret.then(scrubStatsReport):scrubStatsReport(ret)
              }
            }

          }
          catch(_){

          }
          return pc.setLocalDescription=function(desc){
            try{
              desc=scrubDesc(desc)
            }
            catch{

            }
            return realSetLocal(desc)
          },
          ["localDescription",
          "currentLocalDescription",
          "pendingLocalDescription"].forEach(prop=>{
            try{
              const proto=Object.getPrototypeOf(pc),
              desc=Object.getOwnPropertyDescriptor(proto,
              prop)||Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype,
              prop);
              desc&&desc.get&&Object.defineProperty(pc,
              prop,
              {
                configurable:!0,
                enumerable:!0,
                get(){
                  const d=desc.get.call(this);
                  if(d&&d.sdp)try{
                    return{
                      type:d.type,
                      sdp:scrubSdp(d.sdp)
                    }

                  }
                  catch{
                    return d
                  }
                  return d
                }

              })
            }
            catch{

            }

          }),
          pc
        };
        Patched.prototype=RTC.prototype,
        window.RTCPeerConnection=Patched,
        window.webkitRTCPeerConnection&&(window.webkitRTCPeerConnection=Patched),
        window.mozRTCPeerConnection&&(window.mozRTCPeerConnection=Patched),
        log("webrtc_leak_guard_installed",
        {

        })
      }

    }
    catch(e){
      log("webrtc_guard_failed",
      {
        error:String(e)
      })
    }
    WO.blockWebRTCLeak&&log("webrtc_transport_preserved",
    {
      why:"IP-echo requests are blocked without rewriting WebRTC calls, ICE candidates, SDP, or stats."
    });
    try{
      let locationEventCount=0;
      const locationPrivacyOn=()=>!0===WO.blockGeolocation,
      noteLocation=(type,
      detail)=>{
        if(!(++locationEventCount>80))try{
          log(type,
          Object.assign({
            host:location.hostname
          },
          detail||{

          }))
        }
        catch(_){

        }

      },
      blockedLocationError=()=>({
        code:1,
        message:"Location access blocked by WardenOne",
        PERMISSION_DENIED:1,
        POSITION_UNAVAILABLE:2,
        TIMEOUT:3
      }),
      patchLocationMethod=(owner,
      name,
      replacement)=>{
        try{
          const real=owner&&owner[name];
          if("function"!=typeof real||real.__wardenoneLocationGuard||real.__wardenoneMediaShield)return!1;
          const wrapped=replacement(real.bind(owner));
          try{
            Object.defineProperty(wrapped,
            "__wardenoneLocationGuard",
            {
              value:!0
            }),
            Object.defineProperty(wrapped,
            "__wardenoneMediaShield",
            {
              value:!0
            })
          }
          catch(_){

          }
          try{
            Object.defineProperty(owner,
            name,
            {
              configurable:!0,
              writable:!0,
              value:wrapped
            })
          }
          catch(_){
            owner[name]=wrapped
          }
          return!0
        }
        catch(_){
          return!1
        }

      },
      deniedPermissionStatus=()=>({
        name:"geolocation",
        state:"denied",
        onchange:null,
        addEventListener(){

        },
        removeEventListener(){

        },
        dispatchEvent(){
          return!1
        }

      }),
      maskNavigatorValue=(name,
      value)=>{
        try{
          const proto=Navigator&&Navigator.prototype,
          desc=proto&&Object.getOwnPropertyDescriptor(proto,
          name),
          originalValue=(()=>{try{
            return navigator[name]
          }
          catch(_){
            return value
          }})();
          if(desc&&desc.get&&desc.get.__wardenoneLocationGuard)return;
          const getter=function(){
            return"function"==typeof value?value():value
          };
          try{
            Object.defineProperty(getter,
            "__wardenoneLocationGuard",
            {
              value:!0
            })
          }
          catch(_){

          }
          Object.defineProperty(proto||navigator,
          name,
          {
            configurable:!0,
            enumerable:!0,
            get:function(){
              if(locationPrivacyOn())return getter();
              try{
                return desc&&desc.get?desc.get.call(this):originalValue
              }
              catch(_){
                return getter()
              }

            }
          })
        }
        catch(_){

        }

      };
      if(navigator.geolocation){
        const geo=navigator.geolocation,
        liveGeoWatches=new Set,
        fakeGeoWatches=new Set;
        let fakeWatchId=-1;
        const clearLiveGeoWatches=()=>{
          try{
            if(!liveGeoWatches.size)return;
            const clear=geo.clearWatch&&geo.clearWatch.bind(geo);
            if(!clear)return liveGeoWatches.clear();
            Array.from(liveGeoWatches).forEach(id=>{
              try{
                clear(id)
              }
              catch(_){

              }

            }),
            liveGeoWatches.clear()
          }
          catch(_){

          }

        };
        patchLocationMethod(geo,
        "getCurrentPosition",
        real=>function(success,
        error,
        options){
          if(!locationPrivacyOn())return real(success,
          error,
          options);
          clearLiveGeoWatches(),
          noteLocation("blocked_geolocation",
          {
            action:"Location access",
            risk:"High",
            why:"Location Privacy is on"
          });
          try{
            "function"==typeof error&&setTimeout(()=>error(blockedLocationError()),
            0)
          }
          catch(_){

          }

        }),
        patchLocationMethod(geo,
        "watchPosition",
        real=>function(success,
        error,
        options){
          if(!locationPrivacyOn()){
            const id=real(success,
            error,
            options);
            try{
              null!=id&&liveGeoWatches.add(id)
            }
            catch(_){

            }
            return id
          }
          clearLiveGeoWatches(),
          noteLocation("blocked_geolocation",
          {
            action:"Location watch",
            risk:"High",
            why:"Location Privacy is on"
          });
          try{
            "function"==typeof error&&setTimeout(()=>error(blockedLocationError()),
            0)
          }
          catch(_){

          }
          const id=fakeWatchId--;
          return fakeGeoWatches.add(id),
          id
        }),
        patchLocationMethod(geo,
        "clearWatch",
        real=>function(id){
          const fake=fakeGeoWatches.has(id);
          try{
            fake&&fakeGeoWatches.delete(id);
            liveGeoWatches.delete(id)
          }
          catch(_){

          }
          try{
            return fake?void 0:real(id)
          }
          catch(_){

          }

        }),
        document.addEventListener("wo-config-change",
        ()=>{
          locationPrivacyOn()&&clearLiveGeoWatches()
        })
      }
      if(navigator.permissions){
        patchLocationMethod(navigator.permissions,
        "query",
        real=>function(desc){
          try{
            if(locationPrivacyOn()&&desc&&"geolocation"===String(desc.name||"").toLowerCase())return Promise.resolve(deniedPermissionStatus())
          }
          catch(_){

          }
          return real(desc)
        }),
        patchLocationMethod(navigator.permissions,
        "request",
        real=>function(desc){
          try{
            if(locationPrivacyOn()&&desc&&"geolocation"===String(desc.name||"").toLowerCase())return Promise.resolve(deniedPermissionStatus())
          }
          catch(_){

          }
          return real(desc)
        }),
        patchLocationMethod(navigator.permissions,
        "revoke",
        real=>function(desc){
          try{
            if(locationPrivacyOn()&&desc&&"geolocation"===String(desc.name||"").toLowerCase())return Promise.resolve(deniedPermissionStatus())
          }
          catch(_){

          }
          return real(desc)
        })
      }
      maskNavigatorValue("language",
      "en-US"),
      maskNavigatorValue("languages",
      ()=>["en-US",
      "en"]);
      try{
        const proto=Intl&&Intl.DateTimeFormat&&Intl.DateTimeFormat.prototype,
        real=proto&&proto.resolvedOptions;
        real&&!real.__wardenoneLocationGuard&&(proto.resolvedOptions=function(){
          const out=real.apply(this,
          arguments);
          if(locationPrivacyOn())try{
            return Object.assign({

            },
            out,
            {
              timeZone:"UTC"
            })
          }
          catch(_){

          }
          return out
        },
        Object.defineProperty(proto.resolvedOptions,
        "__wardenoneLocationGuard",
        {
          value:!0
        }))
      }
      catch(_){

      }
      try{
        const real=Date.prototype.getTimezoneOffset;
        real&&!real.__wardenoneLocationGuard&&(Date.prototype.getTimezoneOffset=function(){
          return locationPrivacyOn()?0:real.apply(this,
          arguments)
        },
        Object.defineProperty(Date.prototype.getTimezoneOffset,
        "__wardenoneLocationGuard",
        {
          value:!0
        }))
      }
      catch(_){

      }
    }
    catch(e){
      log("location_guard_failed",
      {
        error:String(e)
      })
    }
    if(WO.mediaShield)try{
      let mediaEventCount=0;
      const recentMediaGesture=()=>freshGesture(),
      mediaRisk={
        autoplay:"Low",
        webrtc:"High",
        capture:"High",
        screen:"Critical"
      },
      noteMedia=(type,
      detail)=>{
        if(!(++mediaEventCount>80))try{
          log(type,
          Object.assign({
            host:location.hostname
          },
          detail||{

          }))
        }
        catch(_){

        }

      },
      blockedPromise=(type,
      detail,
      message)=>(noteMedia(type,
      detail),
      Promise.reject(new DOMException(message||"Blocked by WardenOne Media Shield",
      "NotAllowedError"))),
      blockedLocationError=()=>({
        code:1,
        message:"Location access blocked by WardenOne",
        PERMISSION_DENIED:1,
        POSITION_UNAVAILABLE:2,
        TIMEOUT:3
      }),
      mediaKinds=constraints=>({
        audio:!(!constraints||!constraints.audio),
        video:!(!constraints||!constraints.video)
      }),
      captureAction=kinds=>kinds.audio&&kinds.video?"Camera and microphone access":kinds.video?"Camera access":kinds.audio?"Microphone access":"Media access",
      gestureDetail=()=>recentMediaGesture()?"recent user action":"no recent user action",
      patchMethod=(owner,
      name,
      replacement)=>{
        try{
          const real=owner&&owner[name];
          if("function"!=typeof real||real.__wardenoneMediaShield)return!1;
          const wrapped=replacement(real.bind(owner));
          try{
            Object.defineProperty(wrapped,
            "__wardenoneMediaShield",
            {
              value:!0
            })
          }
          catch(_){

          }
          try{
            Object.defineProperty(owner,
            name,
            {
              configurable:!0,
              writable:!0,
              value:wrapped
            })
          }
          catch(_){
            owner[name]=wrapped
          }
          return!0
        }
        catch(_){
          return!1
        }

      },
      md=navigator.mediaDevices;
      if(navigator.geolocation){
        const geo=navigator.geolocation,
        geoBlockOn=()=>!0===WO.blockGeolocation;
        patchMethod(geo,
        "getCurrentPosition",
        real=>function(success,
        error,
        options){
          if(!geoBlockOn())return real(success,
          error,
          options);
          noteMedia("blocked_geolocation",
          {
            action:"Location access",
            risk:"High",
            why:gestureDetail()
          });
          try{
            "function"==typeof error&&setTimeout(()=>error(blockedLocationError()),
            0)
          }
          catch(_){

          }

        }),
        patchMethod(geo,
        "watchPosition",
        real=>function(success,
        error,
        options){
          if(!geoBlockOn())return real(success,
          error,
          options);
          noteMedia("blocked_geolocation",
          {
            action:"Location watch",
            risk:"High",
            why:gestureDetail()
          });
          try{
            "function"==typeof error&&setTimeout(()=>error(blockedLocationError()),
            0)
          }
          catch(_){

          }
          return 0
        });
        navigator.permissions&&patchMethod(navigator.permissions,
        "query",
        real=>function(desc){
          try{
            if(geoBlockOn()&&desc&&"geolocation"===String(desc.name||"").toLowerCase())return Promise.resolve({
              name:"geolocation",
              state:"denied",
              onchange:null,
              addEventListener(){

              },
              removeEventListener(){

              },
              dispatchEvent(){
                return!1
              }

            })
          }
          catch(_){

          }
          return real(desc)
        })
      }
      if(md&&md.getUserMedia&&patchMethod(md,
      "getUserMedia",
      real=>function(constraints){
        const kinds=mediaKinds(constraints),
        detail={
          action:captureAction(kinds),
          audio:kinds.audio,
          video:kinds.video,
          risk:mediaRisk.capture,
          why:gestureDetail()
        };
        if((kinds.audio||kinds.video)&&!1!==WO.blockCameraMic&&!trustedMediaHost)return blockedPromise("blocked_media_capture",
        detail,
        "Camera/microphone access blocked by WardenOne");
        noteMedia(recentMediaGesture()?"warned_media_capture":"warned_hidden_media_capture",
        detail);
        try{
          const ret=real(constraints);
          return ret&&ret.then?ret.then(stream=>{
            try{
              window.postMessage({
                source:"wardenone-media",
                token:__woToken,
                active:!0
              },
              "*");
              const tracks=stream.getTracks?stream.getTracks():[];
              tracks.forEach(tr=>tr.addEventListener&&tr.addEventListener("ended",
              ()=>{
                try{
                  tracks.some(x=>"live"===x.readyState)||window.postMessage({
                    source:"wardenone-media",
                    token:__woToken,
                    active:!1
                  },
                  "*")
                }
                catch(_){

                }

              }))
            }
            catch(_){

            }
            return stream
          }):ret
        }
        catch(_){
          return real(constraints)
        }

      }),
      md&&md.getDisplayMedia&&patchMethod(md,
      "getDisplayMedia",
      real=>function(constraints){
        const detail={
          action:"Screen capture",
          video:!0,
          risk:mediaRisk.screen,
          why:gestureDetail()
        };
        return!1===WO.blockScreenCapture||trustedMediaHost?(noteMedia(recentMediaGesture()?"warned_screen_capture":"warned_hidden_screen_capture",
        detail),
        real(constraints)):blockedPromise("blocked_screen_capture",
        detail,
        "Screen capture blocked by WardenOne")
      }),
      ["getUserMedia",
      "webkitGetUserMedia",
      "mozGetUserMedia",
      "msGetUserMedia"].forEach(name=>{
        patchMethod(navigator,
        name,
        real=>function(constraints,
        onSuccess,
        onError){
          const kinds=mediaKinds(constraints),
          detail={
            action:captureAction(kinds),
            audio:kinds.audio,
            video:kinds.video,
            risk:mediaRisk.capture,
            why:gestureDetail(),
            legacy:!0
          };
          if(!kinds.audio&&!kinds.video||!1===WO.blockCameraMic||trustedMediaHost)return noteMedia(recentMediaGesture()?"warned_media_capture":"warned_hidden_media_capture",
          detail),
          real(constraints,
          onSuccess,
          onError);
          noteMedia("blocked_media_capture",
          detail);
          try{
            "function"==typeof onError&&setTimeout(()=>onError(new DOMException("Camera/microphone access blocked by WardenOne",
            "NotAllowedError")),
            0)
          }
          catch(_){

          }

        })
      }),
      !1!==WO.blockAutoplayMedia&&!trustedMediaHost&&window.HTMLMediaElement){
        const mediaLogged=new WeakSet,
        isMediaElement=el=>el&&/^(AUDIO|VIDEO)$/i.test(el.tagName||""),
        hiddenMedia=el=>{
          try{
            const cs=getComputedStyle(el),
            r=el.getBoundingClientRect();
            return!(!el.hidden&&"none"!==cs.display&&"hidden"!==cs.visibility&&0!==Number(cs.opacity)&&(!("loading"!==document.readyState&&r.width<=2&&r.height<=2)||el.controls||el.hasAttribute("controls")))
          }
          catch(_){
            return!1
          }

        },
        mediaInsidePlayerShell=el=>{
          try{
            return!!playerShellFor(el)
          }
          catch(_){
            return!1
          }

        },
        playBlockReason=el=>isMediaElement(el)&&!mediaInsidePlayerShell(el)&&hiddenMedia(el)?"Hidden media player":"",
        mediaDetail=(el,
        reason)=>({
          action:reason,
          tag:String(el&&el.tagName||"media").toLowerCase(),
          risk:mediaRisk.autoplay,
          muted:!(!el||!el.muted),
          hidden:!(!el||!hiddenMedia(el))
        }),
        neutralizeMedia=(el,
        reason)=>{
          if(!isMediaElement(el)||!reason)return!1;
          try{
            el.autoplay=!1,
            el.removeAttribute("autoplay")
          }
          catch(_){

          }
          try{
            el.muted=!0
          }
          catch(_){

          }
          try{
            el.pause&&el.pause()
          }
          catch(_){

          }
          return mediaLogged.has(el)||(mediaLogged.add(el),
          noteMedia(hiddenMedia(el)?"blocked_hidden_media":"blocked_autoplay_media",
          mediaDetail(el,
          reason))),
          !0
        },
        scanMedia=root=>{
          try{
            if(!root)return;
            if(isMediaElement(root)){
              const reason=playBlockReason(root);
              reason&&neutralizeMedia(root,
              reason)
            }
            root.querySelectorAll&&root.querySelectorAll("audio,video").forEach(el=>{
              const reason=playBlockReason(el);
              reason&&neutralizeMedia(el,
              reason)
            })
          }
          catch(_){

          }

        };
        document.documentElement&&scanMedia(document.documentElement),
        document.addEventListener("DOMContentLoaded",
        ()=>scanMedia(document.documentElement),
        {
          once:!0
        });
        try{
          woObserve(muts=>{
            for(const m of muts)for(const n of m.addedNodes||[])scanMedia(n)
          })
        }
        catch(_){

        }

      }
      if(!0===WO.blockSuspiciousWebRTC&&!trustedMediaHost){
        const patchRTC=name=>{
          try{
            const RTC=window[name];
            if("function"!=typeof RTC||RTC.__wardenoneMediaShield)return;
            const ShieldedRTC=function(cfg,
            constraints){
              if(!recentMediaGesture())throw noteMedia("blocked_suspicious_webrtc",
              {
                action:"RTCPeerConnection",
                risk:mediaRisk.webrtc,
                why:"Created without a recent user action"
              }),
              new DOMException("Suspicious WebRTC connection blocked by WardenOne",
              "SecurityError");
              return new RTC(cfg,
              constraints)
            };
            ShieldedRTC.prototype=RTC.prototype;
            try{
              Object.setPrototypeOf(ShieldedRTC,
              RTC)
            }
            catch(_){

            }
            try{
              Object.defineProperty(ShieldedRTC,
              "__wardenoneMediaShield",
              {
                value:!0
              })
            }
            catch(_){

            }
            window[name]=ShieldedRTC
          }
          catch(_){

          }

        };
        patchRTC("RTCPeerConnection"),
        patchRTC("webkitRTCPeerConnection"),
        patchRTC("mozRTCPeerConnection")
      }
      log("media_shield_active",
      {

      })
    }
    catch(e){
      log("media_shield_failed",
      {
        error:String(e)
      })
    }
    if(WO.removeOverlays&&!/(^|\.)twitch\.tv$|(^|\.)mail\.google\.com$|(^|\.)reddit\.com$|(^|\.)(x\.com|twitter\.com)$|(^|\.)github\.com$/i.test(location.hostname)&&(!isGoogleSearchResults()||WO.blockSearchAiAnswers||WO.blockSponsoredSearchResults||WO.googleSearchResultCleanup)){
      const NUISANCE=/(cookie|consent|gdpr|newsletter|subscribe|sign[\s-]?up for|mailing list|email list|ad ?block|adblock|disable your ad|whitelist|allow ads|notification|push|paywall|register to (read|continue)|create (a )?free account|allow notifications?|turn on notifications?|enable notifications?|click (the )?bell)/i,
      AD_SIGNAL=/(advertisement|sponsored|ad\s*choices|adchoices|download now|continue to (your )?(download|the site)|no thanks,? (i|continue)|skip ad|your download will (begin|start)|presented by)/i,
      BAIT_SIGNAL=/(notification|push|bell|subscribe|download now|watch now|continue to (download|watch|stream)|allow notifications?|enable notifications?)/i,
      PROTECT=/(password|sign[\s-]?in|log[\s-]?in|checkout|payment|card number|billing address|add to (cart|basket)|two[\s-]?factor|verification code|confirm (your )?(order|payment|transaction)|delete|are you sure|accept (all )?cookies)/i,
      seen=new WeakSet,
      undoStack=[],
      overlayCleanerOn=()=>!!(window.__WO_CONFIG__&&window.__WO_CONFIG__.__configReady&&WO.enabled&&WO.removeOverlays),
      installHardOverlayCss=()=>{
        try{
          if(!overlayCleanerOn())return;
          if(document.getElementById("rg-hard-overlay-css"))return;
          const s=document.createElement("style");
          s.id="rg-hard-overlay-css",
          s.textContent='#onesignal-bell-container,.onesignal-bell-container,.onesignal-slidedown-container,.webpushr-bell-widget,.pushcrew-chrome-style-notification,.pushengage-bell-widget,[id*="onesignal"],[class*="onesignal"],[id*="webpush"],[class*="webpush"],[id*="pushengage"],[class*="pushengage"],[id*="push-sub"],[class*="push-sub"]{display:none!important;visibility:hidden!important;pointer-events:none!important;}';
          (document.head||document.documentElement).appendChild(s)
        }
        catch(_){

        }

      },
      showUndoChip=(label,
      restore)=>{
        if(!document.body)return;
        let chip=document.getElementById("rg-undo-chip");
        chip||(chip=document.createElement("div"),
        chip.id="rg-undo-chip",
        S(chip,
        'all:initial!important;position:fixed!important;bottom:16px!important;left:16px!important;z-index:2147483640!important;background:linear-gradient(135deg,#faf2fe,#f4e9fb)!important;color:#3d2a52!important;border-radius:14px!important;padding:9px 11px 9px 14px!important;font-family:"Nunito",system-ui,sans-serif!important;font-size:12.5px!important;display:flex!important;align-items:center!important;gap:11px!important;box-shadow:0 8px 26px rgba(120,55,160,.26)!important;opacity:0!important;transition:opacity .25s!important;max-width:300px!important;'),
        document.body.appendChild(chip),
        requestAnimationFrame(()=>chip.style.setProperty("opacity",
        "1",
        "important")));
        const n=undoStack.length;
        clearNode(chip);
        const txt=document.createElement("span");
        S(txt,
        "flex:1!important;color:#7a5f93!important;font-weight:600!important;"),
        txt.textContent="Tidied "+n+(1===n?" overlay":" overlays"),
        chip.appendChild(txt);
        const undo=document.createElement("button");
        S(undo,
        'all:unset!important;cursor:pointer!important;color:#9d54c9!important;font-weight:700!important;padding:2px 6px!important;font-family:"Quicksand","Nunito",sans-serif!important;'),
        undo.textContent="Undo",
        undo.addEventListener("click",
        ()=>{
          for(;
          undoStack.length;
          )try{
            undoStack.pop()()
          }
          catch{

          }
          chip.remove()
        }),
        chip.appendChild(undo);
        const x=document.createElement("button");
        S(x,
        "all:unset!important;cursor:pointer!important;color:#b89aa2!important;font-size:15px!important;padding:0 2px!important;"),
        x.textContent="x",
        x.addEventListener("click",
        ()=>chip.remove()),
        chip.appendChild(x),
        clearTimeout(chip.__t),
        chip.__t=setTimeout(()=>{
          chip&&(chip.style.setProperty("opacity",
          "0",
          "important"),
          setTimeout(()=>chip.remove(),
          300))
        },
        8e3)
      },
      mediaRectState={
        at:0,
        rects:[]
      },
      mediaRects=()=>{
        const now=Date.now();
        if(now-mediaRectState.at<300)return mediaRectState.rects;
        const out=[],
        add=el=>{
          try{
            const r=el&&el.getBoundingClientRect&&el.getBoundingClientRect();
            r&&r.width>120&&r.height>80&&out.length<28&&out.push(r)
          }
          catch(_){

          }

        };
        try{
          const nodes=document.querySelectorAll('video,iframe,embed,object,'+PLAYER_SHELL_SELECTOR);
          for(let i=0;
          i<nodes.length&&i<160&&out.length<28;
          i++)add(nodes[i])
        }
        catch(_){

        }
        mediaRectState.at=now,
        mediaRectState.rects=out;
        return out
      },
      mediaHitFor=r=>{
        try{
          const cx=(r.left+r.right)/2,
          cy=(r.top+r.bottom)/2;
          for(const m of mediaRects()){
            const ix=Math.max(0,
            Math.min(r.right,
            m.right)-Math.max(r.left,
            m.left)),
            iy=Math.max(0,
            Math.min(r.bottom,
            m.bottom)-Math.max(r.top,
            m.top)),
            intersects=ix*iy>=Math.min(r.width*r.height*.35,
            m.width*m.height*.12),
            centerInside=cx>=m.left&&cx<=m.right&&cy>=m.top&&cy<=m.bottom;
            if(intersects||centerInside)return{
              rect:m,
              x:(cx-m.left)/Math.max(1,
              m.width),
              y:(cy-m.top)/Math.max(1,
              m.height)
            }

          }

        }
        catch(_){

        }
        return null
      },
      PLAYER_CONTROL=/\b(play|pause|volume|mute|unmute|fullscreen|controls?|seek|progress|caption|subtitle|settings|quality|episodes?|servers?|next|previous)\b/i,
      mediaUiProtected=(el,
      blob)=>{
        try{
          if(!el||1!==el.nodeType)return!0;
          const tag=String(el.tagName||"").toUpperCase();
          if(/^(VIDEO|AUDIO|IFRAME|EMBED|OBJECT|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(tag))return!0;
          if(el.querySelector&&el.querySelector("video,audio,iframe,embed,object"))return!0;
          if(playerFrameworkShellFor(el))return!0;
          const shell=playerShellFor(el);
          return!!(shell&&PLAYER_CONTROL.test(String(blob||"")))
        }
        catch(_){
          return!0
        }

      },
      fakeNotifyVisual=(el,
      r,
      cs,
      blob,
      text,
      positioned,
      baitSignal)=>{
        try{
          const w=r.width,
          h=r.height;
          if(mediaUiProtected(el,
          blob))return!1;
          if(!positioned||w<64||h<64||w>280||h>280)return!1;
          if((text||"").trim().length>42)return!1;
          if(el.querySelector&&el.querySelector("input,textarea,select,video,iframe,embed,object"))return!1;
          const lower=String(blob||"").toLowerCase();
          if(/\b(play|pause|volume|mute|unmute|fullscreen|controls?|seek|progress|caption|subtitle|settings)\b/.test(lower)&&!baitSignal)return!1;
          const radius=String(cs.borderRadius||"")+" "+String(cs.borderTopLeftRadius||"")+" "+String(cs.borderTopRightRadius||"")+" "+String(cs.borderBottomLeftRadius||"")+" "+String(cs.borderBottomRightRadius||""),
          roundish=/%/.test(radius)||Math.abs(w-h)<=Math.max(w,
          h)*.38||parseFloat(radius)>=24,
          bg=String(cs.backgroundColor||""),
          visibleBg=!/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(bg),
          elevated=(parseInt(cs.zIndex,
          10)||0)>=10,
          clickish=/pointer/i.test(cs.cursor||"")||elevated||!!el.onclick||!!(el.querySelector&&el.querySelector('a,button,[role="button"],svg,img,canvas,i,span,div')),
          media=mediaHitFor(r),
          onMediaEdge=media&&(media.x>.58||media.y>.54),
          viewportFloat=r.right>innerWidth*.52&&r.bottom>innerHeight*.32,
          hasBadge=!!(el.querySelector&&el.querySelector('[class*="badge"],[class*="count"],[class*="notif"],[class*="bell"],[style*="red"],[style*="orange"]'));
          return!!(roundish&&clickish&&(visibleBg||hasBadge||baitSignal)&&(onMediaEdge||viewportFloat))
        }
        catch(_){
          return!1
        }

      },
      overlayCandidate=el=>{
        let best=el;
        try{
          for(let i=0;
          i<5&&best&&best.parentElement;
          i++){
            const p=best.parentElement;
            if(p===document.body||p===document.documentElement)break;
            const cs=getComputedStyle(p),
            pos=cs.position,
            z=parseInt(cs.zIndex,
            10)||0,
            r=p.getBoundingClientRect(),
            blob=((p.className||"")+" "+(p.id||"")+" "+(p.getAttribute&&p.getAttribute("aria-label")||"")).toLowerCase(),
            smallFloat=r&&r.width>=48&&r.height>=48&&r.width<=360&&r.height<=360,
            floaty="fixed"===pos||"sticky"===pos||"absolute"===pos||z>=10||/(bell|notif|notify|push|subscribe|badge)/i.test(blob);
            if(smallFloat&&floaty)best=p;
            else break
          }

        }
        catch(_){

        }
        return best
      },
      hasLoginUi=el=>{
        try{
          if(!el||1!==el.nodeType)return!1;
          if(el.querySelector('input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"]'))return!0;
          const OAUTH=/\b(continue|sign|log|register|authori[sz]e|connect|proceed)\b[\s\S]{0,14}\bwith\b[\s\S]{0,20}\b(google|apple|facebook|meta|microsoft|azure|outlook|github|gitlab|twitter|linkedin|okta|auth0|slack|discord|spotify|amazon|sso|saml|passkey|phone|email|single[\s-]?sign|your\s+(?:institution|school|college|university|organi[sz]ation|account))/i,
          controls=el.querySelectorAll('button,[role="button"],a[role="button"],a[href],input[type="submit"],input[type="button"]');
          let i=0;
          for(const c of controls){
            if(i++>60)break;
            const t=c.innerText||c.value||c.getAttribute&&c.getAttribute("aria-label")||"";
            if(OAUTH.test(t))return!0;
          }
          const user=el.querySelector('input[type="email"],input[autocomplete="username"],input[autocomplete="email"],input[name*="user" i],input[name*="email" i],input[name*="login" i],input[id*="user" i],input[id*="email" i]');
          if(user){
            let j=0;
            for(const c of controls){
              if(j++>60)break;
              const t=c.innerText||c.value||c.getAttribute&&c.getAttribute("aria-label")||"";
              if(/\b(log[\s-]?in|sign[\s-]?in|continue|next|submit|verify|authori[sz]e|access)\b/i.test(t))return!0;
            }
          }
          return!1;
        }
        catch(_){
          return!1;
        }
      },
      isOverlay=el=>{
        try{
          if(!el||1!==el.nodeType||seen.has(el))return!1;
          if("rg-undo-chip"===el.id||el.id&&el.id.startsWith("rg-"))return!1;
          const cs=getComputedStyle(el),
          pos=cs.position;
          if("none"===cs.display||"hidden"===cs.visibility||0===parseFloat(cs.opacity))return!1;
          const r=el.getBoundingClientRect();
          if(r.top>innerHeight||r.bottom<0)return!1;
          const z=parseInt(cs.zIndex,
          10)||0,
          text=(el.innerText||el.textContent||"").slice(0,
          800),
          attrs=[el.getAttribute("aria-label"),
          el.getAttribute("title"),
          el.getAttribute("data-testid"),
          el.getAttribute("data-test"),
          el.getAttribute("data-role")].filter(Boolean).join(" "),
          blob=text+" "+attrs+" "+(el.className||"")+" "+(el.id||"");
          if(mediaUiProtected(el,
          blob))return!1;
          if(PROTECT.test(text))return!1;
          if(el.querySelector&&el.querySelector('main,[role="main"]'))return!1;
          r.width,
          innerWidth;
          const coversLots=r.width*r.height>=innerWidth*innerHeight*.45,
          tooHuge=r.width>=innerWidth*.92&&r.height>=innerHeight*.92,
          isCentered=Math.abs((r.left+r.right)/2-innerWidth/2)<.18*innerWidth&&Math.abs((r.top+r.bottom)/2-innerHeight/2)<.35*innerHeight,
          adSignal=AD_SIGNAL.test(blob),
          nuisanceText=NUISANCE.test(blob),
          baitSignal=BAIT_SIGNAL.test(blob),
          normalSize=r.width>=220&&r.height>=60,
          smallBait=baitSignal&&r.width>=48&&r.height>=48,
          positioned="fixed"===pos||"sticky"===pos||"absolute"===pos,
          looksModal=positioned&&(z>=20||coversLots||isCentered||"dialog"===el.getAttribute("role")||"true"===el.getAttribute("aria-modal")),
          strongAdEvidence=adSignal||baitSignal&&nuisanceText;
          if(fakeNotifyVisual(el,
          r,
          cs,
          blob,
          text,
          positioned,
          baitSignal))return looksModal&&strongAdEvidence&&!hasLoginUi(el);
          if(!normalSize&&!smallBait)return!1;
          return!!(strongAdEvidence&&looksModal&&!tooHuge&&!hasLoginUi(el))
        }
        catch{
          return!1
        }

      },
      CONTINUE_TEXT=/(no thanks|continue (to )?(download|the site|reading)?|skip( ad)?|continue anyway|proceed to (download|site)|i.?ll continue|maybe later|not now|close and continue)/i,
      findContinueLink=root=>{
        const clickables=root.querySelectorAll('a,button,[role="button"],[onclick],span,div');
        let best=null,
        inspected=0;
        for(const c of clickables){
          if(inspected++>=160)break;
          if(c.tagName==="A"){
            const tgt=(c.getAttribute&&c.getAttribute("target")||"").trim().toLowerCase();
            if(tgt&&tgt!=="_self"&&tgt!=="_top"&&tgt!=="_parent")continue
          }
          const t=(c.innerText||c.textContent||"").trim();
          !t||t.length>80||CONTINUE_TEXT.test(t)&&(!best||t.length<(best.__t?best.__t.length:1e9))&&(best=c,
          best.__t=t)
        }
        return best
      },
      CONSENT_SIGNAL=/(cookie|cookies|consent|gdpr|ccpa|cpra|privacy|tracking|data protection|cmp|onetrust|didomi|usercentrics|trustarc|truste|sourcepoint|quantcast|iubenda|cookiebot|cookieyes|osano|termly|axeptio|cookielaw|cookiehub|advertising choices|do not sell|do not share)/i,
      STRONG_CONSENT_SIGNAL=/(cookie|cookies|consent|gdpr|ccpa|cpra|tracking|data protection|cmp|onetrust|didomi|usercentrics|trustarc|truste|sourcepoint|quantcast|iubenda|cookiebot|cookieyes|osano|termly|axeptio|cookielaw|cookiehub|advertising choices|do not sell|do not share)/i,
      REJECT_CONSENT_TEXT=/\b(reject(?:\s+all)?|reject\s+optional|decline(?:\s+all)?|deny(?:\s+all)?|refuse(?:\s+all)?|do\s+not\s+(?:accept|agree|consent|sell|share)|don'?t\s+consent|necessary\s+only|essential\s+only|required\s+only|only\s+(?:necessary|essential|required)|use\s+(?:necessary|essential|required)|continue\s+without\s+accepting|save\s+without\s+accepting|opt\s*out|object\s+to\s+all|disable\s+all|turn\s+off\s+all|withdraw\s+consent|alle ablehnen|tout refuser|rechazar todo|rifiuta tutt|afwijzen|alles weigeren|odrzu|rejeitar tudo|avvisa alla)\b/i,
      ACCEPT_CONSENT_TEXT=/\b(accept(?:\s+all)?|agree|allow(?:\s+all)?|ok(?:ay)?|got\s+it|enable(?:\s+all)?|i\s+(?:accept|agree)|yes)\b/i,
      PROTECT_CONSENT_TEXT=/\b(sign[\s-]?in|log[\s-]?in|sign[\s-]?up|register|account|profile|subscription|wallet|bank account|password|passcode|2fa|verification code|payment|billing|checkout|purchase|place order|buy now|pay now|card number|shipping|delivery address|delete account|deactivate|unsubscribe|confirm your)\b/i,
      controlText=el=>{
        try{
          return[el.innerText,
          el.textContent,
          el.value,
          el.getAttribute&&el.getAttribute("aria-label"),
          el.getAttribute&&el.getAttribute("title"),
          el.getAttribute&&el.getAttribute("data-testid"),
          el.getAttribute&&el.getAttribute("data-test"),
          el.getAttribute&&el.getAttribute("data-cy"),
          el.getAttribute&&el.getAttribute("data-action")].filter(Boolean).join(" ").replace(/\s+/g,
          " ").trim()
        }
        catch(_){
          return""
        }

      },
      clickConsentReject=root=>{
        try{
          return!1;
          if(/(^|\.)(paypal\.com|stripe\.com|checkout\.com|adyen\.com|braintreepayments\.com|braintreegateway\.com|klarna\.com|squareup\.com|cash\.app)$/i.test(location.hostname))return!1;
          const blob=((root.innerText||root.textContent||"").slice(0,
          1200)+" "+(root.id||"")+" "+(root.className||""));
          if(!CONSENT_SIGNAL.test(blob))return!1;
          if(PROTECT_CONSENT_TEXT.test(blob)&&!STRONG_CONSENT_SIGNAL.test(blob))return!1;
          const controls=root.querySelectorAll&&root.querySelectorAll('button,a[href],[role="button"],input[type="button"],input[type="submit"],label,[tabindex],[onclick],[data-action],[data-testid],[data-test],[data-cy]');
          if(!controls)return!1;
          for(const c of controls){
            const label=controlText(c);
            if(!label||label.length>100)continue;
            if(PROTECT_CONSENT_TEXT.test(label))continue;
            if(ACCEPT_CONSENT_TEXT.test(label)&&!/without\s+accepting|do\s+not\s+(accept|agree|consent)|don'?t\s+consent|reject|decline|deny|refuse|necessary|essential|disable|turn\s+off|opt\s*out/i.test(label))continue;
            if(!REJECT_CONSENT_TEXT.test(label))continue;
            try{
              c.focus&&c.focus({
                preventScroll:!0
              })
            }
            catch(_){

            }
            try{
              ["pointerdown",
              "mousedown",
              "mouseup",
              "click"].forEach(type=>c.dispatchEvent(new MouseEvent(type,
              {
                bubbles:!0,
                cancelable:!0,
                view:window
              })))
            }
            catch(_){

            }
            try{
              c.click()
            }
            catch(_){

            }
            log("consent_rejected",
            {
              matched:label.slice(0,
              60)
            });
            return!0
          }

        }
        catch(_){

        }
        return!1
      },
      hide=(el,
      why)=>{
        if(seen.has(el))return;
        seen.add(el);
        const consentLike=CONSENT_SIGNAL.test(((el.innerText||el.textContent||"").slice(0,
        1200)+" "+(el.id||"")+" "+(el.className||""))),
        cont=findContinueLink(el),
        dlHere=(()=>{
          for(const attr of["data-download-url",
          "data-download",
          "data-url",
          "data-href",
          "data-file-url",
          "data-direct-url"]){
            const holder=el.closest("["+attr+"]")||el.querySelector("["+attr+"]")||(el.hasAttribute(attr)?el:null);
            if(holder){
              const v=holder.getAttribute(attr);
              if(v&&/^https?:\/\//i.test(v))return v
            }

          }
          return null
        })();
        if(consentLike&&clickConsentReject(el))return;
        if(cont||dlHere){
          seen.add(el);
          const removed=[],
          killSels=["#box-c21-modal",
          "#download-modal",
          '[class*="box-c21"]',
          "[data-campaign-id]"],
          toKill=new Set([el]);
          for(const s of killSels)document.querySelectorAll(s).forEach(n=>toKill.add(n));
          if(toKill.forEach(n=>{
            try{
              const ph=document.createComment("rg-removed");
              n.parentNode&&n.parentNode.replaceChild(ph,
              n),
              removed.push({
                node:n,
                placeholder:ph
              })
            }
            catch(_){

            }

          }),
          log("detected_download_gate",
          {
            matched:(el.id||el.className||"download-gate").toString().slice(0,
            60),
            why:"download-gate ad removed"
          }),
          dlHere&&!1!==WO.showDownloadBar&&!document.getElementById("rg-dl-bar"))try{
            const bar=document.createElement("div");
            bar.id="rg-dl-bar",
            bar.setAttribute("style",
            'all:initial!important;position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%) translateY(8px)!important;z-index:2147483641!important;background:rgba(252,247,254,.72)!important;backdrop-filter:blur(16px) saturate(1.3)!important;-webkit-backdrop-filter:blur(16px) saturate(1.3)!important;border:1px solid rgba(176,106,212,.18)!important;border-radius:16px!important;padding:12px 14px!important;display:flex!important;align-items:center!important;gap:13px!important;box-shadow:0 12px 40px rgba(130,70,170,.22),0 2px 8px rgba(130,70,170,.10)!important;font-family:"Nunito",-apple-system,system-ui,sans-serif!important;color:#3d2a4d!important;max-width:380px!important;opacity:0!important;transition:opacity .3s ease,transform .3s cubic-bezier(.34,1.56,.64,1)!important;');
            const ic=document.createElement("div");
            ic.setAttribute("style",
            "all:initial!important;flex:none!important;width:34px!important;height:34px!important;border-radius:10px!important;background:linear-gradient(150deg,#b06ad4,#e07ab0)!important;display:flex!important;align-items:center!important;justify-content:center!important;box-shadow:0 3px 10px rgba(176,106,212,.34)!important;"),
            appendShieldSvg(ic,
            "check-soft"),
            bar.appendChild(ic);
            const txt=document.createElement("div");
            txt.setAttribute("style",
            'all:initial!important;flex:1!important;min-width:0!important;font-family:"Nunito",system-ui,sans-serif!important;');
            const t1=document.createElement("div");
            t1.setAttribute("style",
            'all:initial!important;font-family:"Quicksand","Nunito",system-ui,sans-serif!important;font-weight:700!important;font-size:13.5px!important;color:#3d2a4d!important;line-height:1.3!important;'),
            t1.textContent="Ad blocked";
            const t2=document.createElement("div");
            t2.setAttribute("style",
            'all:initial!important;font-family:"Nunito",system-ui,sans-serif!important;font-size:11.5px!important;color:#8a73a4!important;line-height:1.3!important;margin-top:1px!important;'),
            t2.textContent="Your download is ready",
            txt.appendChild(t1),
            txt.appendChild(t2),
            bar.appendChild(txt);
            const go=document.createElement("button");
            go.setAttribute("style",
            'all:unset!important;cursor:pointer!important;background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;font-weight:700!important;font-size:12.5px!important;padding:9px 17px!important;border-radius:11px!important;font-family:"Quicksand","Nunito",sans-serif!important;flex:none!important;box-shadow:0 3px 10px rgba(176,106,212,.32)!important;transition:transform .12s ease,box-shadow .15s!important;white-space:nowrap!important;'),
            go.textContent="Download",
            go.addEventListener("mouseenter",
            ()=>{
              go.style.setProperty("transform",
              "translateY(-1px)",
              "important")
            }),
            go.addEventListener("mouseleave",
            ()=>{
              go.style.setProperty("transform",
              "translateY(0)",
              "important")
            }),
            go.addEventListener("click",
            ()=>{
              try{
                location.href=dlHere
              }
              catch(_){

              }
              bar.style.setProperty("opacity",
              "0",
              "important"),
              setTimeout(()=>bar.remove(),
              250)
            }),
            bar.appendChild(go);
            const x=document.createElement("button");
            x.setAttribute("style",
            "all:unset!important;cursor:pointer!important;color:#b8a3c8!important;font-size:17px!important;line-height:1!important;padding:2px 4px!important;flex:none!important;transition:color .15s!important;"),
            x.textContent="x",
            x.addEventListener("mouseenter",
            ()=>x.style.setProperty("color",
            "#8a6b9a",
            "important")),
            x.addEventListener("mouseleave",
            ()=>x.style.setProperty("color",
            "#b8a3c8",
            "important")),
            x.addEventListener("click",
            ()=>{
              bar.style.setProperty("opacity",
              "0",
              "important"),
              setTimeout(()=>bar.remove(),
              250)
            }),
            bar.appendChild(x),
            (document.body||document.documentElement).appendChild(bar),
            requestAnimationFrame(()=>{
              bar.style.setProperty("opacity",
              "1",
              "important"),
              bar.style.setProperty("transform",
              "translateX(-50%) translateY(0)",
              "important")
            }),
            setTimeout(()=>{
              document.getElementById("rg-dl-bar")&&(bar.style.setProperty("opacity",
              "0",
              "important"),
              setTimeout(()=>bar.remove(),
              250))
            },
            12e3)
          }
          catch(_){

          }
          return undoStack.push(()=>{
            removed.forEach(({
              node:node,
              placeholder:placeholder
            })=>{
              try{
                placeholder.parentNode&&placeholder.parentNode.replaceChild(node,
                placeholder)
              }
              catch(_){

              }

            });
            const b=document.getElementById("rg-dl-bar");
            b&&b.remove(),
            seen.delete(el)
          }),
          void(document.getElementById("rg-dl-bar")||showUndoChip(why,
          null))
        }
        const prevDisplay=el.style.getPropertyValue("display"),
        prevDisplayPrio=el.style.getPropertyPriority("display");
        el.style.setProperty("display",
        "none",
        "important"),
        log("blocked_overlay",
        {
          matched:(el.id||el.className||el.tagName||"").toString().slice(0,
          60),
          why:why
        }),
        undoStack.push(()=>{
          el.style.setProperty("display",
          prevDisplay||"",
          prevDisplayPrio||""),
          seen.delete(el)
        }),
        showUndoChip(why,
        null)
      },
      sweep=()=>{
        if(!overlayCleanerOn())return;
        if(WO.__overlaysDone)return;
        installHardOverlayCss();
        const candidates=document.querySelectorAll('div,section,aside,a,button,span,i,svg,img,canvas,[onclick],[role="button"],[style*="position:fixed"],[style*="position: fixed"],[style*="position:absolute"],[style*="position: absolute"],[class*="bell"],[id*="bell"],[class*="notif"],[id*="notif"],[class*="notify"],[id*="notify"],[class*="push"],[id*="push"],[class*="subscribe"],[id*="subscribe"]');
        let count=0,
        inspected=0;
        for(const el of candidates){
          if(inspected++>=600||count>=4)break;
          const target=overlayCandidate(el);
          const hit=target&&isOverlay(target)?target:isOverlay(el)?el:null;
          hit&&(hide(hit,
          NUISANCE.test((hit.innerText||"")+hit.className+hit.id)?"nuisance overlay":"fake notification / overlay"),
          count++)
        }

      },
      SAFE_AUTOCLICK=/^(no thanks[ ,!.]*|.*continue downloading.*|continue to download|continue download|skip ad|skip this ad|continue anyway|no thanks i.?ll continue.*)$/i,
      SAFE_DOWNLOAD_URL=u=>{
        try{
          const x=new URL(String(u||""),
          location.href),
          h=x.hostname.toLowerCase(),
          p=x.pathname.toLowerCase();
          return/^https?:$/.test(x.protocol)&&!/^(encrypted-|r[0-9]+---).*\.gstatic\.com$/.test(h)&&!/((^|\.)googlevideo\.com|(^|\.)gvt1\.com)$/.test(h)&&!/(^|\/)video$/i.test(p)&&!/[?&](mime|ctier|range)=/i.test(x.search)
        }
        catch(_){
          return!1
        }

      },
      DL_ATTRS=["data-download-url",
      "data-download",
      "data-file-url",
      "data-direct-url"],
      findDownloadUrl=()=>{
        const roots=document.querySelectorAll('#box-c21-modal,#download-modal,[class*="box-c21"],[data-campaign-id]');
        for(const root of roots){
          for(const attr of DL_ATTRS){
            const el=root.matches&&root.matches("["+attr+"]")?root:root.querySelector("["+attr+"]");
            if(el){
              const v=el.getAttribute(attr);
              if(v&&SAFE_DOWNLOAD_URL(v))return{
                url:v,
                host:el
              }

            }

          }
          const a=root.querySelector('a[download],a[href*="download"],a[href*="/dl"],a[href*="/file"]');
          if(a){
            const v=a.href||a.getAttribute("href");
            if(v&&SAFE_DOWNLOAD_URL(v))return{
              url:v,
              host:a
            }

          }

        }
        return null
      },
      removeAdModal=()=>{
        const sels=["#box-c21-modal",
        "#download-modal",
        '[class*="box-c21"]',
        "[data-campaign-id]"];
        for(const s of sels)document.querySelectorAll(s).forEach(n=>{
          try{
            n.remove()
          }
          catch(_){

          }

        })

      },
      tryAutoSkip=()=>{
        if(!overlayCleanerOn()||!WO.autoSkipDownloadAds||WO.__autoSkippedOnce)return!1;
        let adPresent=!1;
        const scan=document.querySelectorAll('div,section,aside,dialog,[role="dialog"],[aria-modal="true"],[data-campaign-id],[class*="box-c21"]');
        let inspected=0;
        for(const el of scan)try{
          if(inspected++>=160)break;
          const blob=(el.innerText||"")+" "+(el.className||"")+" "+(el.id||"");
          if(AD_SIGNAL.test(blob)||/box-c21|data-campaign/i.test(blob)){
            adPresent=!0;
            break
          }

        }
        catch(_){

        }
        if(!adPresent)return!1;
        const dl=findDownloadUrl();
        if(dl)return WO.__autoSkippedOnce=!0,
        removeAdModal(),
        log("blocked_overlay",
        {
          matched:"box-c21 download-gate",
          why:"auto-skipped -> real download (silent)"
        }),
        setTimeout(()=>{
          try{
            location.href=dl.url
          }
          catch(_){

          }

        },
        20),
        !0;
        const link=findContinueLink(document);
        if(link){
          const label=(link.innerText||link.textContent||"").trim();
          if(SAFE_AUTOCLICK.test(label))return WO.__autoSkippedOnce=!0,
          setTimeout(()=>{
            try{
              link.click()
            }
            catch(_){

            }

          },
          30),
          log("blocked_overlay",
          {
            matched:(link.id||link.className||"continue-link").toString().slice(0,
            60),
            why:"download-gate auto-skipped (link)"
          }),
          !0
        }
        return!1
      },
      cleanerMonitoring=!1,
      start=()=>{
        tryAutoSkip()||sweep();
        if(cleanerMonitoring)return;
        cleanerMonitoring=!0;
        let sweeps=0,
        scheduled=!1,
        lastScan=Date.now();
        const scanGap=350,
        maxSweeps=16,
        scheduleScan=fn=>{
          const delay=Math.max(0,
          scanGap-(Date.now()-lastScan));
          delay?setTimeout(fn,
          delay):"function"==typeof window.requestIdleCallback?window.requestIdleCallback(fn,
          {
            timeout:160
          }):requestAnimationFrame(fn)
        };
        const run=()=>{
          scheduleScan(()=>{
            if(scheduled=!1,
            lastScan=Date.now(),
            sweeps++<maxSweeps)tryAutoSkip()||sweep();
            else try{
              mo.disconnect()
            }
            catch{

            }

          })
        },
        mo=new MutationObserver(()=>{
          scheduled||(scheduled=!0,
          run())
        });
        try{
          mo.observe(document.documentElement,
          {
            childList:!0,
            subtree:!0
          })
        }
        catch{

        }
        setTimeout(()=>{
          try{
            mo.disconnect()
          }
          catch{

          }
          cleanerMonitoring=!1

        },
        8e3)
      };
      const restoreCleanerChanges=()=>{
        for(;
        undoStack.length;
        )try{
          undoStack.pop()()
        }
        catch{

        }
        try{
          const hardCss=document.getElementById("rg-hard-overlay-css");
          hardCss&&hardCss.remove();
          const chip=document.getElementById("rg-undo-chip");
          chip&&chip.remove();
          const bar=document.getElementById("rg-dl-bar");
          bar&&bar.remove()
        }
        catch(_){

        }
      };
      document.addEventListener("wo-config-change",
      ()=>{
        overlayCleanerOn()?start():restoreCleanerChanges()
      }),
      "loading"===document.readyState?document.addEventListener("DOMContentLoaded",
      start):start()
    }
    try{
      window.addEventListener("keydown",
      e=>{
        if(!e.ctrlKey||!e.shiftKey||"W"!==e.key&&"w"!==e.key)return;
        e.preventDefault();
        const report=[],
        all=document.querySelectorAll("*");
        for(const el of all)try{
          const cs=getComputedStyle(el),
          r=el.getBoundingClientRect(),
          z=parseInt(cs.zIndex,
          10)||0,
          big=r.width>=200&&r.height>=100,
          elevated=("fixed"===cs.position||"absolute"===cs.position||"sticky"===cs.position)&&z>=20,
          isIframe="IFRAME"===el.tagName;
          (big&&elevated||isIframe)&&report.push({
            tag:el.tagName.toLowerCase(),
            id:el.id||"",
            cls:("string"==typeof el.className?el.className:"").slice(0,
            120),
            pos:cs.position,
            z:z,
            w:Math.round(r.width),
            h:Math.round(r.height),
            top:Math.round(r.top),
            left:Math.round(r.left),
            iframe:isIframe,
            iframeSrc:isIframe?(el.src||"").slice(0,
            120):void 0,
            textSnippet:isIframe?"(iframe - contents may be cross-origin)":(el.innerText||"").replace(/\s+/g,
            " ").slice(0,
            100)
          })
        }
        catch(_){

        }
        report.sort((a,
        b)=>b.z-a.z);
        const top=report.slice(0,
        12);
        console.log("%c[WardenOne inspect]",
        "color:#9a4fd0;font-weight:bold",
        "on-screen overlays/iframes (top by z-index):"),
        console.table(top),
        console.log("[WardenOne inspect] full JSON (copy this to report a missed pop-up):\n"+JSON.stringify(top,
        null,
        2)),
        log("diagnostic_inspect",
        {
          count:report.length,
          top:top.slice(0,
          6)
        });
        try{
          const note=document.createElement("div");
          note.setAttribute("style",
          "all:initial!important;position:fixed!important;top:16px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;background:#3d2a52!important;color:#fff!important;font-family:system-ui,sans-serif!important;font-size:13px!important;padding:10px 16px!important;border-radius:10px!important;box-shadow:0 6px 20px rgba(0,0,0,.4)!important;"),
          note.textContent="WardenOne inspected "+report.length+" element(s)  -  see the browser Console (F12) and the activity log.",
          document.documentElement.appendChild(note),
          setTimeout(()=>note.remove(),
          4e3)
        }
        catch(_){

        }

      },
      !0)
    }
    catch(_){

    }
    if(!1!==WO.showToasts&&WO_TOP){
      const TOAST_INFO={
        blocked_popup:{
          title:"Popup blocked",
          why:"A new tab/window tried to open without you clicking anything."
        },
        blocked_gestureless_nav:{
          title:"Forced redirect blocked",
          why:"The page tried to send you elsewhere without a click."
        },
        blocked_meta_refresh:{
          title:"Auto-redirect blocked",
          why:"A meta-refresh tried to bounce you to another site."
        },
        blocked_redirect_chain:{
          title:"Redirect chain stopped",
          why:"This page is a relay used by fake-download / ad-spam sites."
        },
        detected_grabber_domain:{
          title:"IP-logger detected",
          why:"This is a known IP-grabber service."
        },
        blocked_grabber_fetch:{
          title:"IP-grabber blocked",
          why:"A hidden request to a known logger was stopped before sending."
        },
        blocked_grabber_xhr:{
          title:"IP-grabber blocked",
          why:"A background request to a known logger was stopped."
        },
        blocked_grabber_beacon:{
          title:"IP-grabber blocked",
          why:"A tracking beacon to a known logger was stopped."
        },
        blocked_grabber_pixel:{
          title:"Tracking pixel blocked",
          why:"A 1x1 logger pixel was stopped before it loaded."
        },
        blocked_ip_lookup:{
          title:"IP lookup blocked",
          why:"A page script tried to ask a third-party IP echo service for your address. WardenOne stopped the request."
        },
        blocked_grabber_element:{
          title:"Grabber element removed",
          why:"An embedded element pointing to a known logger was stripped."
        },
        blocked_safe_browsing_link:{
          title:"Dangerous link blocked",
          why:"An external URL reputation provider flagged this URL as dangerous."
        },
        blocked_safe_browsing_form:{
          title:"Form submission blocked",
          why:"An external URL reputation provider flagged the page or form destination."
        },
        blocked_safe_browsing_paste:{
          title:"Secret paste blocked",
          why:"An external URL reputation provider flagged the page or form destination."
        },
        blocked_token_exfil:{
          title:"Sensitive request protected",
          why:"A token-shaped value was leaving this site for another domain. WardenOne blocked it quietly."
        },
        blocked_skimmer_exfil:{
          title:"Card/password theft blocked",
          why:"Sensitive form data was about to leave this page for another domain. WardenOne stopped it."
        },
        blocked_payment_card_submit:{
          title:"Card submission blocked",
          why:"This checkout looked risky, so WardenOne stopped credit/debit card details before they were sent.",
          severity:"High",
          action:"Card details were not sent. Leave unless you can verify the merchant and address."
        },
        blocked_media_capture:{
          title:"Camera or mic blocked",
          why:"This site tried to access your camera or microphone. Media Shield stopped it."
        },
        blocked_screen_capture:{
          title:"Screen capture blocked",
          why:'This site tried to capture/share your screen  -  a common move in fake "tech support" scams. Media Shield stopped it. Never share your screen with anyone you did not contact yourself.'
        },
        blocked_geolocation:{
          title:"Location blocked",
          why:"This site asked for your precise location. WardenOne denied it because Block location requests is on."
        },
        blocked_autoplay_media:{
          title:"Autoplay media blocked",
          why:"A video or audio player tried to start without a recent click."
        },
        blocked_hidden_media:{
          title:"Hidden media blocked",
          why:"A hidden audio/video player tried to run in the background."
        },
        blocked_suspicious_webrtc:{
          title:"Suspicious WebRTC blocked",
          why:"A page tried to create a real-time media/network connection without a recent click."
        },
        warned_media_capture:{
          title:"Camera or mic requested",
          why:"This site requested camera or microphone access."
        },
        warned_hidden_media_capture:{
          title:"Hidden media request",
          why:"This site requested camera or microphone access without a recent click."
        },
        warned_screen_capture:{
          title:"Screen capture requested",
          why:"This site requested screen capture access."
        },
        warned_hidden_screen_capture:{
          title:"Unexpected screen-share request",
          why:'This site asked to capture/share your screen without any click from you  -  a trick used by fake "tech support" / scam pages. Do not share your screen with anyone you did not contact yourself.'
        },
        warned_shortener:{
          title:"Shortened link",
          why:"This link hides its real destination behind a URL shortener."
        },
        warned_redirect_param:{
          title:"Redirecting link",
          why:"This link routes through a redirect to another site."
        },
        warned_logger_api:{
          title:"Possible tracker",
          why:"This page sent a request to a logging-style endpoint on another domain."
        },
        warned_abuseipdb_server:{
          title:"Suspicious server",
          why:"AbuseIPDB reports suspicious activity from this raw IP address."
        },
        warned_url_reputation:{
          title:"Suspicious URL reputation",
          why:"An external reputation provider reported a suspicious domain or URL."
        },
        warned_phishing:{
          title:"Possible fake site",
          why:"This domain looks like a well-known brand but is not its real address. If you were asked to log in, stop."
        },
        warned_payment_card_entry:{
          title:"Check this checkout",
          why:"You entered card details on a page that has payment-risk signals. Check the address before continuing.",
          severity:"Medium",
          action:"Only continue if you intentionally opened this checkout and trust the merchant."
        },
        warned_fake_update:{
          title:"Fake update scam",
          why:"This page says your browser or Windows is out of date, but it isn't a real vendor site. Real updates never come from a web page  -  don't download or run anything it offers."
        },
        warned_keystroke_pressure:{
          title:"Heavy text-input monitoring",
          why:"This page is monitoring text input heavily  -  it attached an unusually large number of keystroke/paste listeners. Not proof of theft, but unusual. Be careful what you type here."
        },
        warned_honeytoken_read:{
          title:"Suspicious script behaviour detected",
          why:"A script on this page read a decoy credential WardenOne planted in memory. Real site code has no reason to read a secret it didn't create  -  this is how credential-stealing scripts probe. Be cautious here."
        },
        behavioral_risk:{
          title:"Suspicious site behavior",
          why:"This site isn't on any blocklist, but it's behaving like a tracker/scam page (e.g. phoning home on arrival from a brand-new, random domain). Be cautious."
        }

      };
      let toastHostEl=null;
      const ensureHost=()=>{
        if(toastHostEl&&document.documentElement.contains(toastHostEl))return toastHostEl;
        if(!document.documentElement)return null;
        const h=document.createElement("div");
        return h.id="rg-toast-host",
        S(h,
        "all:initial!important;position:fixed!important;top:14px!important;right:14px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;gap:10px!important;max-width:340px!important;font-family:system-ui,-apple-system,sans-serif!important;margin:0!important;padding:0!important;"),
        document.documentElement.appendChild(h),
        toastHostEl=h,
        h
      };
      let lastToastAt=0,
      recentKey="";
      const quietToastHost=v=>{
        try{
          const raw=String(v||"").trim();
          if(!raw)return "";
          const u=raw.includes("://")?new URL(raw):new URL("https://"+raw);
          return regDom(u.hostname)
        }
        catch(_){
          return regDom(String(v||"").split(/[/?#:]/)[0])
        }

      },
      QUIET_GOOGLE_TOAST_TYPES=new Set(["warned_logger_api",
      "detected_thirdparty_tracker"]),
      QUIET_GOOGLE_PAGE_RE=/(^|\.)(google\.com|google\.co\.uk)$/i,
      QUIET_GOOGLE_SERVICE_RE=/(^|\.)(google\.com|google\.co\.uk|googleapis\.com|gstatic\.com|googleusercontent\.com|gvt1\.com|gvt2\.com|ggpht\.com|youtube\.com|ytimg\.com|googlevideo\.com)$/i,
      shouldQuietToast=(type,
      detail)=>{
        try{
          if(!QUIET_GOOGLE_TOAST_TYPES.has(type))return!1;
          const page=quietToastHost(location.hostname);
          if(!QUIET_GOOGLE_PAGE_RE.test(page))return!1;
          const hosts=[detail&&detail.matched,
          detail&&detail.domain,
          detail&&detail.host].map(quietToastHost).filter(Boolean);
          return hosts.some(h=>QUIET_GOOGLE_SERVICE_RE.test(h))
        }
        catch(_){
          return!1
        }

      };
      const showToast=(type,
      detail)=>{
        if(!WO.enabled||!WO.showToasts||shouldQuietToast(type,
        detail))return;
        const info=TOAST_INFO[type];
        if(!info)return;
        const now=Date.now(),
        matched=detail&&detail.matched||"",
        key=type+"|"+matched;
        if(key===recentKey&&now-lastToastAt<1200)return;
        recentKey=key,
        lastToastAt=now;
        const wrap=ensureHost();
        if(!wrap)return;
        const detailWhy=detail&&detail.why?String(detail.why):info.why,
        severity=detail&&detail.severity?String(detail.severity):info.severity||(/^blocked_/.test(type)?"Blocked":/^warned_/.test(type)?"Warning":"Notice"),
        action=detail&&detail.action?String(detail.action):info.action||(/^blocked_/.test(type)?"WardenOne stopped it. No action is needed unless you expected this.":/^warned_/.test(type)?"Check the address and only continue if you trust this site.":"Review this page before sharing sensitive information.");
        const card=document.createElement("div");
        S(card,
        'all:initial!important;box-sizing:border-box!important;display:flex!important;gap:11px!important;align-items:flex-start!important;background:linear-gradient(135deg,#faf2fe,#f4e9fb)!important;border-left:4px solid #9d54c9!important;border-radius:14px!important;padding:13px 15px!important;box-shadow:0 8px 28px rgba(120,55,160,.26)!important;color:#3d2a52!important;font-family:"Nunito",-apple-system,"Segoe UI",system-ui,sans-serif!important;opacity:0!important;transform:translateX(120%)!important;transition:transform .34s cubic-bezier(.34,1.56,.64,1),opacity .25s!important;');
        const body=oDiv(card,
        "flex:1!important;min-width:0!important;");
        oDiv(body,
        'font-size:13.5px!important;font-weight:700!important;color:#3d2a52!important;margin-bottom:2px!important;font-family:"Quicksand","Nunito",system-ui,sans-serif!important;',
        info.title),
        oDiv(body,
        "font-size:12px!important;color:#7a5f93!important;line-height:1.45!important;",
        detailWhy),
        oTextDiv(body,
        "font-size:11px!important;color:#5f456f!important;line-height:1.35!important;margin-top:5px!important;font-weight:700!important;",
        "Severity: "+severity),
        oDiv(body,
        "font-size:11px!important;color:#7a5f93!important;line-height:1.35!important;margin-top:2px!important;",
        action),
        matched&&oTextDiv(body,
        "font-family:ui-monospace,monospace!important;font-size:11px!important;color:#7a5f93!important;margin-top:6px!important;word-break:break-all!important;background:#ede1f8!important;border-radius:7px!important;padding:5px 8px!important;",
        String(matched).slice(0,
        80));
        const dismiss=()=>{
          card.style.setProperty("opacity",
          "0",
          "important"),
          card.style.setProperty("transform",
          "translateX(120%)",
          "important"),
          setTimeout(()=>card.remove(),
          350)
        };
        for(oBtn(card,
        "flex:none!important;width:26px!important;height:26px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(61,42,82,.06)!important;color:#5f456f!important;border-radius:999px!important;font-size:15px!important;font-weight:800!important;line-height:1!important;padding:0!important;margin:-5px -6px 0 2px!important;",
        "x",
        dismiss),
        wrap.appendChild(card),
        requestAnimationFrame(()=>{
          card.style.setProperty("opacity",
          "1",
          "important"),
          card.style.setProperty("transform",
          "translateX(0)",
          "important")
        }),
        setTimeout(dismiss,
        5e3);
        wrap.children.length>4;
        )wrap.removeChild(wrap.firstChild)
      };
      document.addEventListener("wo-event",
      e=>{
        const d=e&&e.detail||{

        };
        (/^blocked_|^detected_|^warned_/.test(d.type||"")||"behavioral_risk"===d.type)&&showToast(d.type,
        d.detail)
      }),
      document.addEventListener("wo-config-change",
      ()=>{
        if(!WO.enabled||!WO.showToasts)try{
          toastHostEl&&toastHostEl.remove(),
          toastHostEl=null
        }
        catch(_){

        }

      })
    }
    {
      const counts=Object.create(null);
      let total=0,
      badgeHost=null,
      badgeButton=null,
      badgePanel=null,
      fadeT=null,
      badgeEventsBound=!1,
      renderBadge=()=>{

      },
      pulseBadge=()=>{

      },
      brightenBadge=()=>{

      };
      const removeBadge=()=>{
        try{
          clearTimeout(fadeT),
          fadeT=null;
          const existing=badgeHost||document.getElementById("rg-badge-host");
          existing&&existing.remove()
        }
        catch(_){

        }
        badgeHost=null,
        badgeButton=null,
        badgePanel=null,
        renderBadge=()=>{

        },
        pulseBadge=()=>{

        },
        brightenBadge=()=>{

        }

      },
      buildBadgeShadow=root=>{
        if(!root)return;
        clearNode(root);
        const style=document.createElement("style");
        style.textContent=':host{all:initial}@keyframes rg-pop{0%{transform:scale(1)}30%{transform:scale(1.14)}60%{transform:scale(.97)}100%{transform:scale(1)}}@keyframes rg-ring{0%{box-shadow:0 4px 16px rgba(157,84,201,.22),0 0 0 0 rgba(216,104,162,.45)}70%{box-shadow:0 4px 16px rgba(157,84,201,.22),0 0 0 12px rgba(216,104,162,0)}100%{box-shadow:0 4px 16px rgba(157,84,201,.22),0 0 0 0 rgba(216,104,162,0)}}.b{position:fixed;bottom:16px;right:16px;z-index:2147483646;font:600 12px/1.3 "Quicksand","Nunito",ui-sans-serif,system-ui,sans-serif;background:rgba(250,245,254,.38);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);border:1px solid rgba(176,106,212,.16);color:#8b73a4;border-radius:999px;padding:7px 13px 7px 11px;cursor:pointer;user-select:none;box-shadow:0 4px 18px rgba(130,70,170,.12);transition:opacity .6s ease,transform .15s,box-shadow .2s,background .3s;display:flex;align-items:center;gap:7px;opacity:.28}.b:hover{opacity:1;background:rgba(250,245,254,.82);transform:translateY(-1px);box-shadow:0 6px 22px rgba(130,70,170,.24)}.b.show{opacity:.92;background:rgba(250,245,254,.7)}.b.hot{opacity:1;color:#8b3fb0;background:rgba(245,228,251,.78)}.b.pop{animation:rg-pop .45s cubic-bezier(.34,1.56,.64,1),rg-ring .6s ease-out}.b.damaged{opacity:1;color:#a8502f;background:rgba(251,233,224,.85)}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#b06fd6,#e07aae);vertical-align:middle;flex:none}.b.hot .dot{box-shadow:0 0 8px rgba(176,111,214,.7)}.b.damaged .dot{background:linear-gradient(135deg,#e0894a,#d6604a)}.panel{position:fixed;bottom:52px;right:16px;z-index:2147483646;display:none;background:rgba(250,242,254,.97);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#5a4670;border-radius:16px;padding:14px 16px;min-width:230px;font:12.5px/1.5 "Nunito",ui-sans-serif,sans-serif;box-shadow:0 12px 34px rgba(120,55,160,.24)}.panel.open{display:block}.panel h3{margin:0 0 10px;font:700 13px "Quicksand","Nunito",sans-serif;color:#3d2a52;display:flex;align-items:center;gap:7px}.panel .r{display:flex;justify-content:space-between;gap:16px;padding:3px 0;color:#7a5f93}.panel .r b{color:#8b3fb0;font-weight:700}.empty{color:#a98fc0}.panel .warn{color:#a8502f;font-weight:600;margin-top:8px;line-height:1.4}';
        const badge=document.createElement("div"),
        dot=document.createElement("span"),
        label=document.createElement("span"),
        panel=document.createElement("div"),
        title=document.createElement("h3"),
        list=document.createElement("div");
        badge.className="b show",
        badge.id="rg-b",
        dot.className="dot",
        label.id="rg-n",
        label.textContent="Guard active",
        badge.appendChild(dot),
        badge.appendChild(label),
        panel.className="panel",
        panel.id="rg-p",
        title.textContent="WardenOne",
        list.id="rg-list",
        list.className="empty",
        list.textContent="Nothing blocked yet  -  all clear",
        panel.appendChild(title),
        panel.appendChild(list),
        root.appendChild(style),
        root.appendChild(badge),
        root.appendChild(panel)
      },
      mount=()=>{
        if(!1!==WO.showBadge){
          if(!badgeHost||!document.documentElement.contains(badgeHost))try{
            const host=badgeHost=document.createElement("div");
            host.id="rg-badge-host",
            host.attachShadow({
              mode:"open"
            }),
            buildBadgeShadow(host.shadowRoot),
            (document.body||document.documentElement).appendChild(host);
            const bEl=badgeButton=host.shadowRoot.getElementById("rg-b"),
            pEl=badgePanel=host.shadowRoot.getElementById("rg-p");
            bEl.addEventListener("click",
            ()=>pEl.classList.toggle("open")),
            fadeT=setTimeout(()=>{
              bEl.classList.contains("hot")||bEl.classList.contains("damaged")||bEl.classList.remove("show")
            },
            4e3),
            brightenBadge=()=>{
              bEl.classList.add("show"),
              clearTimeout(fadeT),
              fadeT=setTimeout(()=>{
                bEl.classList.contains("hot")||bEl.classList.contains("damaged")||bEl.classList.remove("show")
              },
              4e3)
            };
            const LABELS={
              blocked_popup:"Forced popups",
              blocked_gestureless_nav:"Forced redirects",
              blocked_meta_refresh:"Meta-refresh bounces",
              blocked_redirect_chain:"Redirect chains",
              blocked_form_submit:"Forced form-submits",
              detected_grabber_domain:"IP-logger pages",
              gated_adult_site:"Adult-site redirects",
              blocked_grabber_fetch:"Grabber fetches",
              blocked_grabber_xhr:"Grabber XHRs",
                blocked_grabber_beacon:"Grabber beacons",
                blocked_grabber_pixel:"Tracking pixels",
                blocked_ip_lookup:"IP lookup requests",
                blocked_grabber_element:"Grabber elements",
                blocked_thirdparty_cookie:"Third-party cookies",
              blocked_safe_browsing_link:"Dangerous links",
              blocked_safe_browsing_form:"Dangerous forms",
              blocked_safe_browsing_paste:"Dangerous paste targets",
              warned_abuseipdb_server:"Suspicious IP servers",
              blocked_token_exfil:"Sensitive requests",
              blocked_skimmer_exfil:"Skimmer exfiltration",
              blocked_payment_card_submit:"Card submissions",
              blocked_media_capture:"Camera/mic blocks",
              blocked_screen_capture:"Screen-share blocks",
              blocked_geolocation:"Location requests",
              blocked_autoplay_media:"Autoplay media",
              blocked_hidden_media:"Hidden media",
              blocked_suspicious_webrtc:"WebRTC blocks",
              blocked_overlay:"Pop-ups & overlays",
              blocked_config_spoof:"Blocked tamper attempts"
            };
            if(renderBadge=()=>{
              if(!badgeHost||!badgeHost.shadowRoot)return;
              const nEl=host.shadowRoot.getElementById("rg-n"),
              listEl=host.shadowRoot.getElementById("rg-list");
              if(WO.__damaged){
                bEl.classList.add("damaged"),
                nEl.textContent="Guard damaged",
                listEl.className="empty",
                listEl.textContent="Nothing blocked yet.";
                const warn=document.createElement("div");
                return warn.className="warn",
                warn.textContent="A component hit an error on this page. Try reloading; if it keeps happening, toggle WardenOne off and on in the popup.",
                void listEl.appendChild(warn)
              }
              total>0&&(bEl.classList.add("hot"),
              nEl.textContent=total+" blocked");
              const keys=Object.keys(counts);
              if(!keys.length)return listEl.className="empty",
              void(listEl.textContent="Nothing blocked yet  -  all clear");
              listEl.className="",
              listEl.textContent="",
              keys.forEach(k=>{
                const row=document.createElement("div");
                row.className="r";
                const label=document.createElement("span");
                label.textContent=LABELS[k]||k;
                const count=document.createElement("b");
                count.textContent=String(counts[k]),
                row.appendChild(label),
                row.appendChild(count),
                listEl.appendChild(row)
              })
            },
            pulseBadge=()=>{
              badgeButton&&(bEl.classList.remove("pop"),
              bEl.offsetWidth,
              bEl.classList.add("pop"))
            },
            !badgeEventsBound){
              badgeEventsBound=!0;
              const NO_BADGE_TYPES=new Set(["blocked_tracker_request",
              "detected_thirdparty_tracker",
              "blocked_thirdparty_cookie",
              "blocked_webrtc_candidate_listener",
              "blocked_hidden_media",
              "blocked_autoplay_media",
              "blocked_token_exfil"]);
              document.addEventListener("wo-event",
              e=>{
                const t=e.detail&&e.detail.type||"";
                if("detected_download_gate"!==t&&!NO_BADGE_TYPES.has(t))return t&&/_failed$/.test(t)?(WO.__damaged=!0,
                void renderBadge()):void(/^blocked_|^detected_|^gated_/.test(t)&&(counts[t]=(counts[t]||0)+1,
                total++,
                renderBadge(),
                pulseBadge(),
                brightenBadge()))
              })
            }
            WO.__damaged&&renderBadge(),
            renderBadge()
          }
          catch(e){
            log("badge_failed",
            {
              error:String(e)
            })
          }

        }
        else removeBadge()
      },
      syncBadgeVisibility=()=>{
        !1===WO.showBadge?removeBadge():mount()
      };
      document.addEventListener("wo-config-change",
      syncBadgeVisibility),
      document.body?syncBadgeVisibility():document.addEventListener("DOMContentLoaded",
      syncBadgeVisibility)
    };
      try{
        let __woAdCollapseStarted=!1;
        const __woMaybeAdCollapse=()=>{
          if(__woAdCollapseStarted||!WO.adShield||!(!isGoogleSearchResults()||WO.blockSponsoredSearchResults||WO.googleSearchResultCleanup))return;
        __woAdCollapseStarted=!0;
        window.__woAdCollapse=1;
        try{
          var __woAS=document.createElement("style");
          __woAS.textContent='[aria-label="Advertisement"]{display:none!important}';
          (document.head||document.documentElement).appendChild(__woAS)
        }
        catch(e){

        }
        var __woAH=/(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|amazon-adsystem\.com|adnxs\.com|adsrvr\.org|2mdn\.net|moatads\.com|rubiconproject\.com|pubmatic\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|scorecardresearch\.com|adsafeprotected\.com|adform\.net|smartadserver\.com|teads\.tv|3lift\.com|casalemedia\.com)$/i;
        var __woHostOf=function(u){
          try{
            return new URL(u,
            location.href).hostname
          }
          catch(e){
            return ""
          }

        };
        var __woHideAd=function(el){
          try{
            if(el&&el.style&&el.getAttribute("data-wo-collapsed")!=="1"){
              el.style.setProperty("display",
              "none",
              "important");
              el.setAttribute("data-wo-collapsed",
              "1")
            }

          }
          catch(e){

          }

        };
        var __woAdIdRe=/(^|[-_ ])(ad|ads|advert|advertisement|sponsor|sponsored|promo|banner)([-_ ]|s?$)/i;
        var __woSweepAds=function(){
          try{
            document.querySelectorAll('ins.adsbygoogle,[id^="google_ads_iframe"],[id^="div-gpt-ad"],[id^="aswift_"],[data-google-query-id],iframe[id^="google_ads"]').forEach(__woHideAd);
            var ifr=document.querySelectorAll("iframe[src]");
            for(var i=0;
            i<ifr.length;
            i++){
              var fr=ifr[i],
              h=__woHostOf(fr.src);
              if(__woAH.test(h)){
                __woHideAd(fr);
                var p=fr.parentElement;
                if(p&&p.children.length===1&&/^(div|ins|aside|section)$/i.test(p.tagName)&&__woAdIdRe.test((p.id||"")+" "+(typeof p.className==="string"?p.className:""))){
                  __woHideAd(p)
                }

              }

            }

          }
          catch(e){

          }

        };
        var __woAdPend=0,
        __woSchedAds=function(){
          if(__woAdPend)return;
          __woAdPend=1;
          setTimeout(function(){
            __woAdPend=0;
            __woSweepAds()
          },
          400)
        };
        if(document.readyState!=="loading")__woSweepAds();
        document.addEventListener("DOMContentLoaded",
        __woSweepAds);
        try{
          new MutationObserver(__woSchedAds).observe(document.documentElement,
          {
            childList:!0,
            subtree:!0
          })
        }
        catch(e){

        }

      };
      __woMaybeAdCollapse(),
      document.addEventListener("wo-config-change",
      __woMaybeAdCollapse)
    }
    catch(e){

    };
    log("installed",
    {
      href:location.href,
      version:__WO_RUNTIME_VERSION
    }),
    window.__wardenOneReadyVersion=__WO_RUNTIME_VERSION
  };
  const __woStartWhenConfigured=()=>{
    window.__WO_CONFIG__&&window.__WO_CONFIG__.__configReady&&__woStartRuntime()
  };
  try{
    document.addEventListener("wo-config-change",
    __woStartWhenConfigured)
  }
  catch(_){

  }
  __woStartWhenConfigured(),
  setTimeout(__woStartRuntime,
  1500)
}
();

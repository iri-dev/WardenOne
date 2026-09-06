/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What a page can actually learn, measured rather than asserted.
 *
 * This file is injected TWICE into the same page: once into the MAIN world, where
 * WardenOne's shields have patched the globals, and once into the ISOLATED world, which
 * shares the DOM but has its own copies of every prototype and so sees the browser
 * unmodified. The two sets of readings are then compared.
 *
 * THAT COMPARISON IS THE WHOLE POINT. A privacy test that reads a setting and prints a
 * tick is worth nothing -- it would still print the tick after a Chrome update broke the
 * shield underneath it. Here, "protected" means the value a page receives is
 * demonstrably not the value the browser would have given it. If a shield ever stops
 * working, these two columns start agreeing and the test says so.
 *
 * Nothing here touches the network. Every probe is answerable inside the page, which is
 * also why some things a reader would reasonably expect -- what referrer a third party
 * receives, whether a third-party cookie survives -- are absent rather than guessed at:
 * they need a server on the other end, and inventing a result for them would be the
 * exact dishonesty this page exists to avoid.
 *
 * It must also leave the page as it found it. The probes that write to the document undo
 * themselves, including the history entry.
 */
(function () {
  'use strict';

  const out = { at: Date.now(), errors: {} };
  const pending = [];

  function safe(name, fn) {
    try {
      const value = fn();
      if (value && typeof value.then === 'function') {
        pending.push(value.then((v) => { out[name] = v; }, (e) => {
          out.errors[name] = String((e && e.message) || e).slice(0, 120);
        }));
        return;
      }
      out[name] = value;
    } catch (e) {
      out.errors[name] = String((e && e.message) || e).slice(0, 120);
    }
  }

  /* A short stable digest. Not cryptographic and does not need to be: it exists so two
     readings can be compared and shown without printing a wall of base64. */
  function digest(text) {
    const s = String(text == null ? '' : text);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = (h1 ^ s.charCodeAt(i)) >>> 0;
      h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + s.charCodeAt(i) * (i + 1)) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  }

  /* ---- canvas ------------------------------------------------------------- */
  safe('canvas2d', () => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 60;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.textBaseline = 'top';
    ctx.font = '16px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 10, 100, 30);
    ctx.fillStyle = '#069';
    ctx.fillText('WardenOne privacy test ☠', 12, 14);
    ctx.strokeStyle = 'rgba(102,204,0,0.7)';
    ctx.arc(60, 30, 20, 0, Math.PI * 2);
    ctx.stroke();
    return digest(c.toDataURL());
  });

  safe('canvasImageData', () => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'rgb(120,180,240)';
    ctx.fillRect(0, 0, 40, 40);
    const d = ctx.getImageData(0, 0, 40, 40).data;
    let acc = '';
    for (let i = 0; i < d.length; i += 997) acc += d[i] + ',';
    return digest(acc);
  });

  /* ---- webgl -------------------------------------------------------------- */
  safe('webgl', () => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : '',
      renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '',
      version: String(gl.getParameter(gl.VERSION) || ''),
    };
  });

  /* ---- webgpu ------------------------------------------------------------- */
  safe('webgpu', () => {
    if (!navigator.gpu || !navigator.gpu.requestAdapter) return null;
    return Promise.resolve(navigator.gpu.requestAdapter()).then((adapter) => {
      if (!adapter) return { adapter: false };
      const limits = {};
      try {
        for (const key of ['maxTextureDimension2D', 'maxBufferSize', 'maxBindGroups']) {
          if (adapter.limits && adapter.limits[key] != null) limits[key] = Number(adapter.limits[key]);
        }
      } catch (_) { /* limits are optional */ }
      let info = '';
      try {
        if (adapter.info) info = [adapter.info.vendor, adapter.info.architecture].filter(Boolean).join(' / ');
      } catch (_) { info = ''; }
      return { adapter: true, info: info, limits: limits, features: (adapter.features && adapter.features.size) || 0 };
    });
  });

  /* ---- audio -------------------------------------------------------------- */
  safe('audio', () => {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 4096, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    return ctx.startRendering().then((buf) => {
      const data = buf.getChannelData(0);
      let acc = 0;
      for (let i = 0; i < data.length; i++) acc += Math.abs(data[i]);
      return digest(acc.toFixed(8));
    });
  });

  /* ---- the machine -------------------------------------------------------- */
  safe('hardware', () => ({
    cores: Number(navigator.hardwareConcurrency) || 0,
    memory: Number(navigator.deviceMemory) || 0,
    platform: String(navigator.platform || ''),
    touchPoints: Number(navigator.maxTouchPoints) || 0,
  }));

  safe('screenInfo', () => ({
    width: Number(screen.width) || 0,
    height: Number(screen.height) || 0,
    availWidth: Number(screen.availWidth) || 0,
    availHeight: Number(screen.availHeight) || 0,
    colorDepth: Number(screen.colorDepth) || 0,
    /* Whether a second monitor exists is answered with no permission at all. */
    isExtended: screen.isExtended === true,
  }));

  safe('uaHighEntropy', () => {
    if (!navigator.userAgentData || !navigator.userAgentData.getHighEntropyValues) return null;
    return navigator.userAgentData.getHighEntropyValues(
      ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion'],
    ).then((v) => ({
      architecture: String(v.architecture || ''),
      bitness: String(v.bitness || ''),
      model: String(v.model || ''),
      platformVersion: String(v.platformVersion || ''),
      uaFullVersion: String(v.uaFullVersion || ''),
    }));
  });

  safe('timezone', () => {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    return { timeZone: String(opts.timeZone || ''), locale: String(opts.locale || '') };
  });

  /* ---- the newer measuring surfaces --------------------------------------- */
  safe('fonts', () => {
    if (typeof window.queryLocalFonts !== 'function') return { available: false };
    /* Not called. queryLocalFonts opens a permission prompt, and a test that makes the
       browser ask for something is a test nobody runs twice. Whether the function is
       reachable at all is the part worth reporting. */
    return { available: true, called: false };
  });

  safe('voices', () => {
    if (!window.speechSynthesis || !speechSynthesis.getVoices) return null;
    const list = speechSynthesis.getVoices() || [];
    return { count: list.length, sample: digest(list.map((v) => v.name + '|' + v.lang).join(',')) };
  });

  safe('keyboardLayout', () => {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return null;
    return navigator.keyboard.getLayoutMap().then((map) => {
      const keys = [];
      try { map.forEach((value, code) => { if (keys.length < 12) keys.push(code + ':' + value); }); } catch (_) { /* size only */ }
      return { size: (map && map.size) || 0, sample: digest(keys.join(',')) };
    });
  });

  safe('gamepads', () => {
    if (!navigator.getGamepads) return null;
    let live = 0;
    const pads = navigator.getGamepads() || [];
    for (let i = 0; i < pads.length; i++) if (pads[i]) live++;
    /* The count only. Reading the model strings into a privacy report would be handing
       over the very thing the report is about. */
    return { connected: live };
  });

  safe('mediaCapabilities', () => {
    if (!navigator.mediaCapabilities || !navigator.mediaCapabilities.decodingInfo) return null;
    return navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: { contentType: 'video/mp4; codecs="avc1.42E01E"', width: 1920, height: 1080, bitrate: 3000000, framerate: 30 },
    }).then((info) => ({
      supported: info.supported === true,
      smooth: info.smooth === true,
      powerEfficient: info.powerEfficient === true,
    }));
  });

  safe('battery', () => {
    if (typeof navigator.getBattery !== 'function') return { available: false };
    return navigator.getBattery().then((b) => ({
      available: true,
      level: Number(b.level),
      charging: b.charging === true,
    }));
  });

  safe('network', () => {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return { available: false };
    return { available: true, effectiveType: String(c.effectiveType || ''), rtt: Number(c.rtt) || 0 };
  });

  /* ---- local addresses ----------------------------------------------------- */
  safe('webrtcLocalIps', () => {
    const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (typeof PC !== 'function') return { available: false, ips: [] };
    /* No STUN server, so nothing leaves this machine: host candidates alone reveal the
       LOCAL addresses, which is the leak worth measuring and the one that needs no
       network to demonstrate. A public-address test would mean contacting a third party,
       which is not something a privacy test should do without being asked. */
    return new Promise((resolve) => {
      let pc = null;
      const ips = [];
      const done = () => {
        try { if (pc) pc.close(); } catch (_) { /* already closed */ }
        resolve({ available: true, ips: ips.slice(0, 8), stun: false });
      };
      try {
        pc = new PC({ iceServers: [] });
        pc.onicecandidate = (e) => {
          if (!e || !e.candidate) { done(); return; }
          const m = /(\d{1,3}(?:\.\d{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{0,4}){2,})/i.exec(String(e.candidate.candidate || ''));
          if (m && ips.indexOf(m[1]) < 0 && ips.length < 8) ips.push(m[1]);
        };
        pc.createDataChannel('wo');
        Promise.resolve(pc.createOffer()).then((o) => pc.setLocalDescription(o)).catch(() => done());
        setTimeout(done, 1500);
      } catch (_) { done(); }
    });
  });

  /* ---- things WardenOne changes about the page itself ---------------------- */
  safe('linkPing', () => {
    const a = document.createElement('a');
    a.href = 'https://example.invalid/destination';
    a.setAttribute('ping', 'https://tracker.invalid/click');
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.documentElement.appendChild(a);
    return new Promise((resolve) => {
      /* The sweep runs on a mutation, and the click-time strip runs on mousedown, so a
         frame is given for either to happen before reading the attribute back. */
      setTimeout(() => {
        const still = a.hasAttribute('ping');
        const href = a.getAttribute('href');
        try { a.remove(); } catch (_) { /* already gone */ }
        resolve({ pingSurvived: still, hrefIntact: href === 'https://example.invalid/destination' });
      }, 350);
    });
  });

  safe('linkParams', () => {
    const a = document.createElement('a');
    a.href = 'https://example.invalid/item?utm_source=probe&fbclid=probe&id=7';
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.documentElement.appendChild(a);
    return new Promise((resolve) => {
      setTimeout(() => {
        const href = a.getAttribute('href') || '';
        try { a.remove(); } catch (_) { /* already gone */ }
        resolve({
          href: href,
          utmGone: href.indexOf('utm_source') < 0,
          fbclidGone: href.indexOf('fbclid') < 0,
          /* The one that must survive. A cleaner that takes the site's own parameter has
             broken the link, and that is a failure, not a stronger protection. */
          idKept: href.indexOf('id=7') >= 0,
        });
      }, 350);
    });
  });

  safe('historyParams', () => {
    if (!window.history || typeof history.replaceState !== 'function') return null;
    const original = location.href;
    try {
      const probe = new URL(original);
      probe.searchParams.set('utm_source', 'probe');
      probe.searchParams.set('wo_probe_keep', '1');
      history.replaceState(history.state, '', probe.toString());
      const seen = location.search;
      return {
        utmGone: seen.indexOf('utm_source') < 0,
        ownParamKept: seen.indexOf('wo_probe_keep') >= 0,
      };
    } catch (e) {
      return null;
    } finally {
      /* Put the address back exactly as it was, whatever happened above. A privacy test
         that leaves its own parameters in the reader's address bar has failed at the one
         thing it was measuring. */
      try { history.replaceState(history.state, '', original); } catch (_) { /* nothing else to do */ }
    }
  });

  safe('storage', () => {
    const result = { localStorage: false, indexedDB: false, cookiesEnabled: navigator.cookieEnabled === true };
    try { localStorage.setItem('__wo_probe', '1'); localStorage.removeItem('__wo_probe'); result.localStorage = true; } catch (_) { result.localStorage = false; }
    try { result.indexedDB = !!window.indexedDB; } catch (_) { result.indexedDB = false; }
    return result;
  });

  safe('page', () => ({
    origin: String(location.origin || ''),
    referrerPresent: !!document.referrer,
    /* What THIS page sees, which is not what a third party receives. The difference
       matters enough that the report says so rather than implying the two are the same. */
    referrerLength: String(document.referrer || '').length,
  }));

  return Promise.all(pending).then(() => out, () => out);
})();

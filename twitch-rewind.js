/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Twitch Local DVR.
 *
 * Twitch removed rewind on live streams, and its own MediaSource history
 * cannot be extended safely (the transmux/playlist state is already gone, so an
 * old seek freezes, turns black, and snaps back to live). Feeding a private
 * MediaSource from MediaRecorder does not work either: Chromium rejects the
 * MediaRecorder WebM byte stream (MEDIA_ERR_SRC_NOT_SUPPORTED).
 *
 * Instead this opt-in feature runs ONE continuous MediaRecorder over the live
 * <video>'s captureStream and keeps its short timeslice chunks in RAM. Those
 * chunks belong to a single continuous recording, so concatenating them yields
 * one seekable WebM that plays back with no per-clip seams. Rewind loads that
 * blob over the Twitch video and seeks; delayed playback follows live by
 * rebuilding the blob and swapping surfaces only when it runs out of buffered
 * material. Memory stays bounded by rotating the recorder and dropping whole
 * aged-out recordings. Nothing is ever fetched, saved, or uploaded.
 */
(function () {
  'use strict';

  const WO_GUARD_VERSION = '1.0.1';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.top !== window) return;
  if (window.__wardenOneTwitchRewindReady === WO_GUARD_VERSION) return;
  if (window.__wardenOneTwitchRewindReady) {
    try {
      if (typeof window.__wardenOneTwitchRewindDispose === 'function') window.__wardenOneTwitchRewindDispose();
    } catch (_) {}
  }
  window.__wardenOneTwitchRewindReady = WO_GUARD_VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  // Chrome's extension events are not DOM events: they are not covered by the abort signal above
  // and they have no equivalent of removeEventListener-by-signal. Repair reinstalls this script in
  // every frame, so a listener registered here and never removed accumulates one more copy per
  // Repair -- and every copy answers, so old and new bridges race on form and media health.
  //
  // The exact callback reference has to be kept, because removeListener matches by identity.
  const woChromeListeners = [];
  const woOnMessage = (fn) => {
    try {
      woOnMessage(fn);
      woChromeListeners.push([chrome.runtime.onMessage, fn]);
    } catch (_) {}
    return fn;
  };

  window.__wardenOneTwitchRewindDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
    const chromeHeld = woChromeListeners.splice(0, woChromeListeners.length);
    for (const [event, fn] of chromeHeld) {
      try { event.removeListener(fn); } catch (_) {}
    }
  };

  const isHarness = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  const DEFAULT_BUFFER_SECONDS = 300;
  const MIN_BUFFER_SECONDS = 60;
  const MAX_BUFFER_SECONDS_CAP = 1800; // 30-minute ceiling
  // 5 minutes -> 640 MB keeps the historical budget; scales with the setting.
  const BUFFER_BYTES_PER_SECOND = Math.round(640 * 1024 * 1024 / 300);
  const MAX_BUFFER_BYTES_CAP = 1536 * 1024 * 1024; // 1.5 GB hard RAM ceiling
  const CHUNK_MS = 1000;
  // The harness rotates recordings quickly so the cross-recording boundary is
  // exercised in seconds instead of minutes.
  const REC_ROTATE_MS = isHarness ? 20000 : 180000;
  const REC_ROTATE_BYTES = 280 * 1024 * 1024;
  const ROTATE_OVERLAP_MS = 1000;
  const RECORDER_STOP_TIMEOUT_MS = 5000;
  const REPLAY_LOAD_TIMEOUT_MS = 6000;
  const REPLAY_STALL_TIMEOUT_MS = 2500;
  const REPLAY_MONITOR_MS = 250;
  const REPLAY_REFRESH_LEAD_SECONDS = 3;
  const REPLAY_REVEAL_CAP_MS = 1200;
  const RECORDING_STALL_MS = 4000;
  const REPLAY_RATES = [1, 1.25, 1.5, 2];
  const MIN_REPLAY_SECONDS = 2;
  const LIVE_TOLERANCE_SECONDS = 0.75;
  const RESERVED_ROUTES = new Set([
    '', 'directory', 'downloads', 'drops', 'inventory', 'jobs', 'login', 'p',
    'search', 'settings', 'signup', 'subscriptions', 'turbo', 'videos', 'wallet',
  ]);

  let enabled = false;
  let routeKey = '';
  let sourceVideo = null;
  let mimeType = '';

  // Continuous-recording buffer. Each recording is one uninterrupted
  // MediaRecorder session; its chunks concatenate into a single seekable blob.
  let recordings = [];
  let activeRecording = null;
  let captureStreamRef = null;
  let recorderGeneration = 0;
  let nextRecordingId = 1;
  let totalBytes = 0;
  let bufferSeconds = DEFAULT_BUFFER_SECONDS;
  let bufferBytes = DEFAULT_BUFFER_SECONDS * BUFFER_BYTES_PER_SECOND;
  let maxRecordings = 3;
  let statusError = '';

  let controlsRoot = null;
  let controlsShadow = null;
  let back10Button = null;
  let back30Button = null;
  let back60Button = null;
  let back300Button = null;
  let positionButton = null;
  let positionText = null;
  let popover = null;
  let bufferText = null;
  let previewText = null;
  let slider = null;
  let liveButton = null;
  let rowLiveButton = null;
  let speedButtons = [];
  let popoverOpen = false;
  let scrubbing = false;
  let controlsOverlay = null;
  let controlsOverlayOriginalZIndex = '';
  let playbackControlStyle = null;

  let replayLayer = null;
  let replayVideos = [];
  let frontVideo = null;
  let backVideo = null;
  let replayActive = false;
  let replayToken = 0;
  let replayLoadSerial = 0;
  let replayPausedByUser = false;
  let refreshing = false;
  let recovering = false;
  let replayMonitorTimer = 0;
  let pendingReveal = null;
  let replayRate = 1;
  let recordingStalled = false;
  let replayUrls = new WeakMap();
  let replayLoadControllers = new WeakMap();
  let loadedInfo = new WeakMap();

  let savedMuted = false;
  let savedVolume = 1;
  let sourceMuteOverridden = false;
  let sourceResumePending = false;
  let sourceResumeSerial = 0;
  let lastTranslatedSourcePauseAt = 0;
  let activeNativePlaybackButton = null;
  let nativePlaybackButtonOriginals = new WeakMap();

  let scanTimer = 0;
  let syncTimer = 0;

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  function routeChannelKey() {
    const part = String(location.pathname || '').split('/').filter(Boolean)[0] || '';
    const key = part.toLowerCase();
    if (!/^[a-z0-9_]+$/.test(key) || RESERVED_ROUTES.has(key)) return '';
    return key;
  }

  function formatSeconds(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function findPrimaryVideo() {
    let best = null;
    let bestScore = 0;
    document.querySelectorAll('video:not([data-wardenone-replay])').forEach((video) => {
      const rect = video.getBoundingClientRect();
      if (rect.width < 300 || rect.height < 160) return;
      const style = getComputedStyle(video);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const score = rect.width * rect.height + (video.readyState >= 2 ? 1000000 : 0);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    });
    return best;
  }

  function selectMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    return candidates.find((type) => {
      try { return MediaRecorder.isTypeSupported(type); } catch (_) { return false; }
    }) || '';
  }

  function videoBitrate(video) {
    const width = Number(video && video.videoWidth) || 1280;
    const height = Number(video && video.videoHeight) || 720;
    const pixels = width * height;
    if (pixels >= 2560 * 1440) return 16000000;
    if (pixels >= 1920 * 1080) return 12000000;
    if (pixels >= 1280 * 720) return 8000000;
    if (pixels >= 854 * 480) return 5000000;
    return 3000000;
  }

  function qualityLabel() {
    if (!sourceVideo) return '';
    const width = Number(sourceVideo.videoWidth) || 0;
    const height = Number(sourceVideo.videoHeight) || 0;
    const mbps = videoBitrate(sourceVideo) / 1000000;
    return (width && height ? width + '×' + height + ' · ' : '') + mbps.toFixed(0) + ' Mbps';
  }

  function stopStreamTracks(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    try { stream.getTracks().forEach((track) => track.stop()); } catch (_) {}
  }

  function streamHasLiveVideo(stream) {
    return !!(stream && typeof stream.getTracks === 'function'
      && stream.getTracks().some((track) => track.kind === 'video' && track.readyState === 'live'));
  }

  // ---- Continuous recording -------------------------------------------------

  function recordingMediaSeconds(recording) {
    if (!recording || !recording.startedAt) return 0;
    return Math.max(0, (recording.lastAt - recording.startedAt) / 1000);
  }

  function availableRange() {
    if (!recordings.length) return null;
    const last = recordings[recordings.length - 1];
    const endAt = last.lastAt || last.startedAt;
    const firstStart = recordings[0].startedAt || endAt;
    const startAt = Math.max(firstStart, endAt - bufferSeconds * 1000);
    if (!(endAt > startAt)) return null;
    return { startAt, endAt, duration: (endAt - startAt) / 1000 };
  }

  function pruneRecordings() {
    if (!recordings.length) return;
    const last = recordings[recordings.length - 1];
    const liveAt = last.lastAt || last.startedAt;
    while (recordings.length > 1) {
      const first = recordings[0];
      if (first === activeRecording) break;
      const agedOut = (first.lastAt || first.startedAt) <= liveAt - bufferSeconds * 1000;
      const overBytes = totalBytes > bufferBytes;
      const tooMany = recordings.length > maxRecordings;
      if (agedOut || overBytes || tooMany) {
        totalBytes = Math.max(0, totalBytes - first.bytes);
        recordings.shift();
      } else break;
    }
  }

  function ensureCaptureStream() {
    if (!sourceVideo) return null;
    if (streamHasLiveVideo(captureStreamRef)) return captureStreamRef;
    const capture = sourceVideo.captureStream || sourceVideo.mozCaptureStream;
    if (typeof capture !== 'function') return null;
    let stream = null;
    try { stream = capture.call(sourceVideo); } catch (_) { return null; }
    if (!streamHasLiveVideo(stream)) { stopStreamTracks(stream); return null; }
    if (captureStreamRef && captureStreamRef !== stream) stopStreamTracks(captureStreamRef);
    captureStreamRef = stream;
    return stream;
  }

  function ensureRecording() {
    if (!enabled || !sourceVideo || activeRecording) return;
    if (sourceVideo.readyState < 2 || sourceVideo.ended) return;
    if (!mimeType) mimeType = selectMimeType();
    if (typeof MediaRecorder === 'undefined' || !mimeType) {
      statusError = 'Local DVR is not supported by this browser';
      return;
    }
    const stream = ensureCaptureStream();
    if (!stream) { statusError = 'Waiting for capturable Twitch video'; return; }
    startRecordingSession(stream, recorderGeneration);
  }

  function startRecordingSession(stream, generation) {
    let recorder = null;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: videoBitrate(sourceVideo),
        audioBitsPerSecond: 192000,
      });
    } catch (_) {
      statusError = 'Could not start the local DVR recorder';
      return;
    }
    const recording = {
      id: nextRecordingId++,
      mimeType,
      recorder,
      generation,
      chunks: [],
      startedAt: 0,
      lastAt: 0,
      bytes: 0,
      rotated: false,
      intentionalStop: false,
      stopWatchdog: 0,
    };
    woOn(recorder, 'dataavailable', (event) => {
      if (!event.data || !event.data.size) return;
      const now = performance.now();
      if (!recording.startedAt) recording.startedAt = now;
      recording.lastAt = now;
      recording.chunks.push({ blob: event.data, at: now, bytes: event.data.size });
      recording.bytes += event.data.size;
      totalBytes += event.data.size;
      pruneRecordings();
      if (recording === activeRecording && !recording.rotated) {
        const durationMs = recording.lastAt - recording.startedAt;
        if (durationMs >= REC_ROTATE_MS || recording.bytes >= REC_ROTATE_BYTES) rotateRecording(recording);
      }
    });
    woOn(recorder, 'error', () => {
      if (recording.generation === recorderGeneration && !recording.intentionalStop) {
        statusError = 'The local DVR recorder stopped unexpectedly';
      }
    });
    woOn(recorder, 'stop', () => {
      clearTimeout(recording.stopWatchdog);
      recording.stopWatchdog = 0;
      if (activeRecording === recording) activeRecording = null;
      // An unexpected stop (Twitch swapped the <video>, quality change, ad break)
      // ends the capture track. Rebuild from a fresh stream so the buffer heals.
      if (!recording.intentionalStop && enabled && sourceVideo && !activeRecording
        && recording.generation === recorderGeneration) {
        captureStreamRef = null;
        ensureRecording();
      }
    }, { once: true });
    try {
      recorder.start(CHUNK_MS);
    } catch (_) {
      statusError = 'Could not start the local DVR recorder';
      return;
    }
    statusError = '';
    recordings.push(recording);
    activeRecording = recording;
  }

  function rotateRecording(previous) {
    if (!previous || previous.rotated) return;
    previous.rotated = true;
    // Start the successor while the old recorder is still running so the new one
    // captures the seam, then stop the old one. Playback crosses the boundary by
    // seeking the successor to the same wall-clock position (it overlaps).
    const stream = ensureCaptureStream();
    if (stream) startRecordingSession(stream, recorderGeneration);
    woTimeout(() => stopRecorder(previous), ROTATE_OVERLAP_MS);
  }

  function stopRecorder(recording) {
    if (!recording) return;
    recording.intentionalStop = true;
    if (recording.recorder && recording.recorder.state !== 'inactive') {
      try { recording.recorder.stop(); } catch (_) {
        if (activeRecording === recording) activeRecording = null;
        return;
      }
      recording.stopWatchdog = woTimeout(() => {
        if (activeRecording === recording) activeRecording = null;
      }, RECORDER_STOP_TIMEOUT_MS);
    } else if (activeRecording === recording) {
      activeRecording = null;
    }
  }

  function teardownRecording() {
    recorderGeneration += 1;
    recordings.forEach((recording) => {
      recording.intentionalStop = true;
      clearTimeout(recording.stopWatchdog);
      recording.stopWatchdog = 0;
      if (recording.recorder && recording.recorder.state !== 'inactive') {
        try { recording.recorder.stop(); } catch (_) {}
      }
    });
    recordings = [];
    totalBytes = 0;
    activeRecording = null;
    stopStreamTracks(captureStreamRef);
    captureStreamRef = null;
  }

  // ---- Controls UI ----------------------------------------------------------

  function rewindIcon(seconds) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4V1L6.5 5.5 11 10V7a6 6 0 1 1-5.2 3H2.6A9 9 0 1 0 11 4Z"></path><text x="11.6" y="15.7">${seconds}</text></svg>`;
  }

  function createControls() {
    if (controlsRoot || !document.documentElement) return;
    controlsRoot = document.createElement('div');
    controlsRoot.id = 'wardenone-twitch-rewind';
    controlsRoot.style.cssText = 'all:initial;position:relative;z-index:2147483647;display:inline-flex;align-items:center;height:3rem;flex:0 0 auto;';
    controlsShadow = controlsRoot.attachShadow({ mode: 'open' });
    controlsShadow.innerHTML = `
      <style>
        :host{all:initial}
        .controls{display:flex;align-items:center;height:3rem;color:#efeff1;font:600 12px/1 Inter,Arial,sans-serif}
        button{appearance:none;border:0;border-radius:.4rem;background:transparent;color:#efeff1;cursor:pointer;font:700 11px/1 Inter,Arial,sans-serif}
        button:hover:not(:disabled){background:rgba(255,255,255,.16)}button:focus-visible,input:focus-visible{outline:2px solid #bf94ff;outline-offset:2px}button:disabled{cursor:default;opacity:.35}
        .icon{display:grid;place-items:center;width:3rem;height:3rem;padding:.6rem}.icon svg{width:2.2rem;height:2.2rem;overflow:visible;fill:currentColor}.icon text{fill:currentColor;font:900 6px/1 Arial,sans-serif;text-anchor:middle}
        .position{display:flex;align-items:center;gap:5px;height:3rem;min-width:48px;padding:0 8px;font-variant-numeric:tabular-nums}.dot{width:7px;height:7px;border-radius:50%;background:#eb0400;box-shadow:0 0 0 1px rgba(0,0,0,.25)}.position.behind .dot{background:#9147ff}
        .rowLive{display:flex;align-items:center;gap:5px;height:3rem;padding:0 7px;color:#fff}.rowLive[hidden]{display:none}.liveDot{width:7px;height:7px;border-radius:50%;background:#eb0400}
        .popover{position:absolute;bottom:3.7rem;left:0;box-sizing:border-box;width:300px;padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:#18181b;box-shadow:0 8px 28px rgba(0,0,0,.55);color:#efeff1;visibility:hidden;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;pointer-events:none}
        .popover.open{visibility:visible;opacity:1;transform:none;pointer-events:auto}.head,.ends{display:flex;align-items:center;justify-content:space-between}.title{font-size:13px}.status{margin:7px 0 10px;color:#adadb8;font-size:11px;font-weight:500}.preview{font-variant-numeric:tabular-nums}
        input[type=range]{--position:100%;display:block;width:100%;height:18px;margin:0;appearance:none;background:transparent;cursor:pointer}input[type=range]:disabled{cursor:default;opacity:.4}
        input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:3px;background:linear-gradient(to right,#9147ff 0 var(--position),rgba(255,255,255,.28) var(--position) 100%)}input[type=range]::-webkit-slider-thumb{width:14px;height:14px;margin-top:-5px;appearance:none;border:2px solid #fff;border-radius:50%;background:#9147ff;box-shadow:0 1px 4px rgba(0,0,0,.7)}
        .ends{margin-top:4px;color:#adadb8;font-size:10px;font-weight:500}.live{margin-left:8px;padding:6px 8px;background:#772ce8}.live:hover:not(:disabled){background:#9147ff}
        .speeds{display:flex;align-items:center;gap:4px;margin-top:10px}.speedLabel{margin-right:4px;color:#adadb8;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}.spd{flex:1;padding:5px 0;background:rgba(255,255,255,.08);font-size:11px}.spd:hover:not(:disabled){background:rgba(255,255,255,.18)}.spd.active{background:#772ce8}.spd.active:hover{background:#9147ff}
        @media(max-width:700px){.position{min-width:42px;padding:0 5px}.popover{width:270px}}
      </style>
      <div class="controls" role="group" aria-label="WardenOne Twitch local rewind">
        <button type="button" class="icon back10" title="Rewind 10 seconds" aria-label="Rewind 10 seconds">${rewindIcon(10)}</button>
        <button type="button" class="icon back30" title="Rewind 30 seconds" aria-label="Rewind 30 seconds">${rewindIcon(30)}</button>
        <button type="button" class="icon back60" title="Rewind 1 minute, or to the oldest locally buffered point" aria-label="Rewind 1 minute">${rewindIcon('1m')}</button>
        <button type="button" class="icon back300" title="Rewind 5 minutes, or to the oldest locally buffered point" aria-label="Rewind 5 minutes">${rewindIcon('5m')}</button>
        <button type="button" class="position" title="Open five-minute rewind timeline" aria-expanded="false"><span class="dot"></span><span class="positionText">DVR</span></button>
        <button type="button" class="rowLive" title="Return to the live stream" aria-label="Go LIVE" hidden><span class="liveDot"></span>LIVE</button>
        <div class="popover" role="dialog" aria-label="Five-minute rewind timeline">
          <div class="head"><span class="title">Local rewind</span><span class="preview">LIVE</span></div>
          <div class="status">Building the five-minute buffer</div>
          <input type="range" min="0" max="0" value="0" step="0.25" aria-label="Rewind position" disabled>
          <div class="ends"><span class="oldest">0:00 available</span><span><button type="button" class="live">Go LIVE</button></span></div>
          <div class="speeds" role="group" aria-label="Playback speed"><span class="speedLabel">Speed</span><button type="button" class="spd" data-rate="1" aria-pressed="true">1×</button><button type="button" class="spd" data-rate="1.25" aria-pressed="false">1.25×</button><button type="button" class="spd" data-rate="1.5" aria-pressed="false">1.5×</button><button type="button" class="spd" data-rate="2" aria-pressed="false">2×</button></div>
        </div>
      </div>`;

    back10Button = controlsShadow.querySelector('.back10');
    back30Button = controlsShadow.querySelector('.back30');
    back60Button = controlsShadow.querySelector('.back60');
    back300Button = controlsShadow.querySelector('.back300');
    positionButton = controlsShadow.querySelector('.position');
    positionText = controlsShadow.querySelector('.positionText');
    popover = controlsShadow.querySelector('.popover');
    bufferText = controlsShadow.querySelector('.status');
    previewText = controlsShadow.querySelector('.preview');
    slider = controlsShadow.querySelector('input[type="range"]');
    liveButton = controlsShadow.querySelector('.live');
    rowLiveButton = controlsShadow.querySelector('.rowLive');
    speedButtons = Array.from(controlsShadow.querySelectorAll('.spd'));

    speedButtons.forEach((button) => {
      woOn(button, 'click', () => setReplayRate(Number(button.dataset.rate) || 1));
    });
    updateSpeedButtons();
    woOn(back10Button, 'click', () => rewindBy(10));
    woOn(back30Button, 'click', () => rewindBy(30));
    woOn(back60Button, 'click', () => rewindBy(60));
    woOn(back300Button, 'click', () => rewindBy(300));
    woOn(positionButton, 'click', () => setPopoverOpen(!popoverOpen));
    woOn(liveButton, 'click', goLive);
    woOn(rowLiveButton, 'click', goLive);
    woOn(slider, 'pointerdown', () => { scrubbing = true; });
    woOn(slider, 'pointerup', () => { scrubbing = false; seekFromSlider(); });
    woOn(slider, 'input', previewSlider);
    woOn(slider, 'change', seekFromSlider);
  }

  function setPopoverOpen(open) {
    popoverOpen = !!open;
    if (popover) popover.classList.toggle('open', popoverOpen);
    if (positionButton) positionButton.setAttribute('aria-expanded', String(popoverOpen));
  }

  function findControlGroup() {
    if (!sourceVideo) return null;
    const player = sourceVideo.closest('.video-player') || sourceVideo.closest('.video-player__container') || sourceVideo.parentElement;
    return (player && player.querySelector('.player-controls__left-control-group'))
      || document.querySelector('.player-controls__left-control-group');
  }

  function findNativePlaybackButton() {
    const group = findControlGroup();
    return (group && group.querySelector('[data-a-target="player-play-pause-button"]'))
      || document.querySelector('[data-a-target="player-play-pause-button"]');
  }

  function ensurePlaybackControlStyle() {
    if (playbackControlStyle || !document.documentElement) return;
    playbackControlStyle = document.createElement('style');
    playbackControlStyle.id = 'wardenone-twitch-playback-style';
    playbackControlStyle.textContent = `
      [data-a-target="player-play-pause-button"][data-wardenone-replay-paused="true"]{position:relative!important;color:transparent!important}
      [data-a-target="player-play-pause-button"][data-wardenone-replay-paused="true"] svg{visibility:hidden!important}
      [data-a-target="player-play-pause-button"][data-wardenone-replay-paused="true"]::after{content:"";position:absolute;left:50%;top:50%;width:0;height:0;border-top:8px solid transparent;border-bottom:8px solid transparent;border-left:13px solid #efeff1;transform:translate(-42%,-50%)}
    `;
    document.documentElement.appendChild(playbackControlStyle);
  }

  function rememberNativePlaybackButton(button) {
    if (!button || nativePlaybackButtonOriginals.has(button)) return;
    nativePlaybackButtonOriginals.set(button, {
      ariaLabel: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
    });
  }

  function restoreNativePlaybackButton(button) {
    if (!button) return;
    const original = nativePlaybackButtonOriginals.get(button);
    delete button.dataset.wardenoneReplayPaused;
    if (!original) return;
    if (original.ariaLabel === null) button.removeAttribute('aria-label');
    else button.setAttribute('aria-label', original.ariaLabel);
    if (original.title === null) button.removeAttribute('title');
    else button.setAttribute('title', original.title);
    nativePlaybackButtonOriginals.delete(button);
  }

  function syncNativePlaybackButton() {
    if (!replayActive) {
      restoreNativePlaybackButton(activeNativePlaybackButton);
      activeNativePlaybackButton = null;
      return;
    }
    const button = findNativePlaybackButton();
    if (!button) return;
    if (activeNativePlaybackButton && activeNativePlaybackButton !== button) {
      restoreNativePlaybackButton(activeNativePlaybackButton);
    }
    activeNativePlaybackButton = button;
    rememberNativePlaybackButton(button);
    const pausedValue = String(replayPausedByUser);
    const label = replayPausedByUser ? 'Play' : 'Pause';
    if (button.dataset.wardenoneReplayPaused !== pausedValue) {
      button.dataset.wardenoneReplayPaused = pausedValue;
    }
    if (button.getAttribute('aria-label') !== label) {
      button.setAttribute('aria-label', label);
    }
    const title = label + ' delayed stream';
    if (button.getAttribute('title') !== title) {
      button.setAttribute('title', title);
    }
  }

  function playbackButtonInEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.find((node) => node && node.nodeType === 1
      && typeof node.matches === 'function'
      && node.matches('[data-a-target="player-play-pause-button"]')) || null;
  }

  function editablePlaybackTarget(target) {
    return !!(target && target.nodeType === 1 && (target.isContentEditable || target.closest(
      'input,textarea,select,button,a,[contenteditable="true"],[role="textbox"],[role="button"],[role="slider"],[role="menuitem"],[role="option"],[tabindex]:not([tabindex="-1"])',
    )));
  }

  function handleNativePlaybackClick(event) {
    if (!replayActive || !playbackButtonInEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setPopoverOpen(false);
    const sourcePauseWasJustTranslated = replayPausedByUser
      && performance.now() - lastTranslatedSourcePauseAt < 150;
    if (!sourcePauseWasJustTranslated) toggleReplayPlayback();
  }

  function handleNativePlaybackKey(event) {
    if (!replayActive || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const key = String(event.key || '').toLowerCase();
    if (key !== ' ' && key !== 'spacebar' && key !== 'k') return;
    if (editablePlaybackTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'keydown') toggleReplayPlayback();
  }

  function resumeLiveSourceDuringReplay(video, translatePause) {
    if (!replayActive || !video || video !== sourceVideo || video.ended) return;
    if (translatePause && !replayPausedByUser) {
      lastTranslatedSourcePauseAt = performance.now();
      setReplayPaused(true);
    }
    if (sourceResumePending) return;
    sourceResumePending = true;
    const resumeSerial = ++sourceResumeSerial;
    video.muted = true;
    let promise = null;
    try { promise = video.play(); } catch (_) {}
    const done = () => {
      if (resumeSerial === sourceResumeSerial) sourceResumePending = false;
    };
    if (promise && typeof promise.then === 'function') promise.then(done, done);
    else done();
  }

  function keepSourcePlayingDuringReplay(event) {
    resumeLiveSourceDuringReplay(event && event.currentTarget, true);
  }

  function restoreControlsLayer() {
    if (controlsOverlay) controlsOverlay.style.zIndex = controlsOverlayOriginalZIndex;
    controlsOverlay = null;
    controlsOverlayOriginalZIndex = '';
  }

  function raiseControlsLayer(group) {
    const nextOverlay = group && group.closest('.video-player__overlay');
    if (nextOverlay === controlsOverlay) return;
    restoreControlsLayer();
    if (!nextOverlay) return;
    controlsOverlay = nextOverlay;
    controlsOverlayOriginalZIndex = nextOverlay.style.zIndex;
    nextOverlay.style.zIndex = '20';
  }

  function mountControls() {
    if (!enabled || !sourceVideo || !controlsRoot) return;
    const group = findControlGroup();
    if (!group) return;
    raiseControlsLayer(group);
    if (controlsRoot.parentNode === group) return;
    const volume = group.querySelector('[data-a-target="player-mute-unmute-button"]');
    const volumeSlot = volume && Array.from(group.children).find((child) => child.contains(volume));
    if (volumeSlot) volumeSlot.insertAdjacentElement('afterend', controlsRoot);
    else group.appendChild(controlsRoot);
  }

  function removeControls() {
    if (controlsRoot) controlsRoot.remove();
    controlsRoot = null;
    controlsShadow = null;
    back10Button = null;
    back30Button = null;
    back60Button = null;
    back300Button = null;
    positionButton = null;
    positionText = null;
    popover = null;
    bufferText = null;
    previewText = null;
    slider = null;
    liveButton = null;
    rowLiveButton = null;
    speedButtons = [];
    popoverOpen = false;
    scrubbing = false;
    restoreControlsLayer();
  }

  // ---- Replay ---------------------------------------------------------------

  function createReplayVideo() {
    const video = document.createElement('video');
    video.dataset.wardenoneReplay = 'true';
    video.dataset.wardenoneActive = 'false';
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.muted = true;
    video.style.cssText = 'position:absolute;z-index:1;inset:0;display:block;width:100%;height:100%;object-fit:contain;background:transparent;opacity:0;visibility:visible;';
    woOn(video, 'ended', () => {
      const endedToken = replayToken;
      woTimeout(() => {
        if (endedToken !== replayToken || !replayActive || video !== frontVideo || replayPausedByUser) return;
        // Ran out of buffered material at the edge of what we have; try to pick
        // up freshly recorded chunks or the next recording.
        if (!refreshing) refreshFollow(replayToken);
      }, 0);
    });
    woOn(video, 'waiting', () => {
      // Ran out of buffered material at the live edge of the snapshot; pull in
      // freshly recorded chunks instead of waiting for the stall monitor.
      if (replayActive && video === frontVideo && !replayPausedByUser && !refreshing) refreshFollow(replayToken);
    });
    woOn(video, 'error', () => {
      if (replayActive && video === frontVideo) {
        statusError = 'A replay clip stopped decoding; playback recovered';
        recoverReplay();
      }
    });
    replayLayer.appendChild(video);
    return video;
  }

  function ensureReplayLayer() {
    if (!sourceVideo) return;
    if (!replayLayer) {
      replayLayer = document.createElement('div');
      replayLayer.id = 'wardenone-twitch-replay-layer';
      replayLayer.style.cssText = 'position:absolute;z-index:1;inset:0;display:none;overflow:hidden;background:transparent;pointer-events:none;';
      replayVideos = [createReplayVideo(), createReplayVideo()];
      frontVideo = null;
      backVideo = replayVideos[0];
    }
    const videoRef = sourceVideo.closest('.video-ref') || sourceVideo.parentElement;
    const container = videoRef && videoRef.parentElement;
    if (!container || replayLayer.parentNode === container) return;
    container.insertBefore(replayLayer, videoRef.nextSibling);
  }

  function revokeReplayUrl(video) {
    if (!video) return;
    const url = replayUrls.get(video);
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (_) {}
    replayUrls.delete(video);
  }

  function cancelReplayLoad(video) {
    if (!video) return;
    const controller = replayLoadControllers.get(video);
    if (controller) {
      replayLoadControllers.delete(video);
      controller.cancel();
    }
    video.dataset.wardenoneLoadId = String(++replayLoadSerial);
  }

  function resetReplayVideo(video) {
    if (!video) return;
    cancelReplayLoad(video);
    try { video.pause(); } catch (_) {}
    revokeReplayUrl(video);
    loadedInfo.delete(video);
    video.removeAttribute('src');
    video.playbackRate = 1;
    video.dataset.wardenoneActive = 'false';
    video.style.zIndex = '1';
    video.style.opacity = '0';
    video.style.visibility = 'visible';
    try { video.load(); } catch (_) {}
  }

  function stopReplayMonitor() {
    clearTimeout(replayMonitorTimer);
    replayMonitorTimer = 0;
  }

  function otherReplayVideo(video) {
    return replayVideos.find((candidate) => candidate !== video) || null;
  }

  // Load a recording's concatenated blob into a surface and seek to offsetSeconds.
  // MediaRecorder blobs report an unknown duration, so probe (seek far past the
  // end) to force Chromium to resolve the real duration before the target seek.
  function loadInto(video, recording, offsetSeconds, sessionToken, onReady, onError) {
    if (!video || !recording || !recording.chunks.length || sessionToken !== replayToken) return 0;
    resetReplayVideo(video);
    const loadId = ++replayLoadSerial;
    video.dataset.wardenoneLoadId = String(loadId);
    video.dataset.wardenoneSegmentId = String(recording.id);
    video.volume = clamp(savedVolume, 0, 1);
    video.muted = true;
    const snapshotEnd = recordingMediaSeconds(recording);
    let url = '';
    try {
      url = URL.createObjectURL(new Blob(recording.chunks.map((chunk) => chunk.blob), { type: recording.mimeType }));
    } catch (_) {
      woTimeout(() => { if (valid() && typeof onError === 'function') onError('blob'); }, 0);
      return loadId;
    }
    replayUrls.set(video, url);
    video.src = url;

    let done = false;
    let sought = false;
    const listeners = [];
    const timers = [];
    const valid = () => sessionToken === replayToken
      && video.dataset.wardenoneLoadId === String(loadId)
      && replayActive;
    const listen = (type, handler, options) => {
      woOn(video, type, handler, options);
      listeners.push([type, handler, options]);
    };
    const later = (handler, delay) => {
      const timer = woTimeout(handler, delay);
      timers.push(timer);
      return timer;
    };
    const cleanup = () => {
      listeners.forEach(([type, handler, options]) => video.removeEventListener(type, handler, options));
      timers.forEach(clearTimeout);
      const controller = replayLoadControllers.get(video);
      if (controller && controller.loadId === loadId) replayLoadControllers.delete(video);
    };
    const succeed = () => {
      if (done) return;
      done = true;
      cleanup();
      if (valid()) onReady(video, { recording, endSeconds: snapshotEnd, baseWall: recording.startedAt });
    };
    const fail = (reason) => {
      if (done) return;
      done = true;
      cleanup();
      if (valid() && typeof onError === 'function') onError(reason || 'decode');
    };
    replayLoadControllers.set(video, { loadId, cancel: () => { if (!done) { done = true; cleanup(); } } });

    // A single continuous recording seeks accurately without a full-duration
    // probe, so jump straight to the target. The old scan-to-end-of-file probe
    // only added latency (and a visible hitch) to every rewind.
    const seekToTarget = () => {
      if (sought || !valid()) return;
      sought = true;
      listen('seeked', succeed, { once: true });
      try { video.currentTime = Math.max(0, Number(offsetSeconds) || 0); } catch (_) { succeed(); return; }
      // A seek to (or past) the position we already hold may not emit "seeked".
      later(succeed, 1000);
    };
    listen('loadedmetadata', seekToTarget, { once: true });
    listen('error', () => fail('decode'), { once: true });
    later(() => fail('timeout'), REPLAY_LOAD_TIMEOUT_MS);
    try { video.load(); } catch (_) {}
    if (video.readyState >= 1) later(seekToTarget, 0);
    return loadId;
  }

  function scheduleBackReset(previous, sessionToken) {
    woTimeout(() => {
      if (sessionToken !== replayToken) return;
      if (previous && previous !== frontVideo) {
        resetReplayVideo(previous);
        backVideo = previous;
      } else {
        backVideo = otherReplayVideo(frontVideo);
      }
      if (frontVideo) frontVideo.style.zIndex = '2';
    }, 150);
  }

  function cancelPendingReveal() {
    const pending = pendingReveal;
    pendingReveal = null;
    if (!pending) return;
    pending.cancel();
    if (pending.video && pending.video !== frontVideo) resetReplayVideo(pending.video);
  }

  // Reveal the incoming surface only once it is genuinely presenting new frames,
  // so a rewind or follow-live swap never flashes the frozen seek target. The
  // outgoing surface (or the live picture, on the very first rewind) keeps
  // showing until then. On a composited tab requestVideoFrameCallback fires the
  // instant a real frame is painted (the crispest possible cut); "timeupdate"/
  // "playing" and a hard cap are the fallback for a backgrounded/offscreen tab
  // that withholds paint callbacks, so the reveal never blocks.
  function revealWhenAdvancing(video, sessionToken, commit) {
    const startTime = Number(video.currentTime) || 0;
    let done = false;
    let frameHandle = 0;
    const teardown = () => {
      video.removeEventListener('timeupdate', onProgress);
      video.removeEventListener('playing', onProgress);
      clearTimeout(cap);
      if (frameHandle && typeof video.cancelVideoFrameCallback === 'function') {
        try { video.cancelVideoFrameCallback(frameHandle); } catch (_) {}
      }
    };
    const finish = () => {
      if (done) return;
      done = true;
      teardown();
      if (pendingReveal && pendingReveal.video === video) pendingReveal = null;
      if (sessionToken === replayToken && replayActive) commit();
    };
    const onProgress = () => {
      if ((Number(video.currentTime) || 0) > startTime + 0.02) finish();
    };
    woOn(video, 'timeupdate', onProgress);
    woOn(video, 'playing', onProgress);
    if (typeof video.requestVideoFrameCallback === 'function') {
      try { frameHandle = video.requestVideoFrameCallback(() => finish()); } catch (_) {}
    }
    const cap = woTimeout(finish, REPLAY_REVEAL_CAP_MS);
    pendingReveal = { video, sessionToken, cancel: () => { if (!done) { done = true; teardown(); } } };
  }

  // Promote a freshly loaded surface to the visible one. When syncFrom is set
  // (a live-follow or cross-recording refresh) the incoming surface is nudged to
  // the outgoing surface's exact wall-clock position so the swap is seamless.
  function showAsFront(video, info, sessionToken, syncFrom) {
    if (sessionToken !== replayToken || !replayActive) { resetReplayVideo(video); return; }
    cancelPendingReveal();
    const previous = frontVideo;
    if (syncFrom && previous && previous !== video) {
      const previousInfo = loadedInfo.get(previous);
      if (previousInfo) {
        const previousWall = previousInfo.baseWall + (Number(previous.currentTime) || 0) * 1000;
        const alignedOffset = (previousWall - info.baseWall) / 1000;
        if (alignedOffset >= 0 && alignedOffset <= info.endSeconds) {
          try { video.currentTime = Math.min(alignedOffset, info.endSeconds - 0.05); } catch (_) {}
        }
      }
    }
    loadedInfo.set(video, info);
    video.playbackRate = replayRate;
    video.muted = true;
    // Stage above the visible surface but keep it transparent until it decodes.
    video.style.zIndex = '3';

    const commit = () => {
      if (sessionToken !== replayToken || !replayActive) {
        if (video !== frontVideo) resetReplayVideo(video);
        return;
      }
      frontVideo = video;
      replayVideos.forEach((surface) => { surface.dataset.wardenoneActive = surface === video ? 'true' : 'false'; });
      video.style.opacity = '1';
      if (replayLayer) replayLayer.style.background = '#000';
      if (previous && previous !== video) {
        previous.style.zIndex = '1';
        previous.style.opacity = '0';
        try { previous.pause(); } catch (_) {}
      }
      if (replayPausedByUser) { try { video.pause(); } catch (_) {} }
      video.muted = savedMuted;
      scheduleBackReset(previous, sessionToken);
      syncNativePlaybackButton();
      startReplayMonitor(sessionToken);
    };

    if (replayPausedByUser) {
      try { video.pause(); } catch (_) {}
      commit();
      return;
    }

    let playPromise = null;
    try { playPromise = video.play(); } catch (_) { recoverReplay(); return; }
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(() => { if (!replayPausedByUser) recoverReplay(); });
    }
    revealWhenAdvancing(video, sessionToken, commit);
  }

  // Where should playback continue from wall-clock currentWall: the same
  // recording if it has grown, otherwise the next (overlapping) recording.
  function recordingToContinue(info, currentWall) {
    const recording = info.recording;
    const index = recordings.indexOf(recording);
    if (index < 0) {
      // The recording we were playing was evicted while we watched it (rewound
      // near the oldest edge and live rolled past); resume from the oldest
      // material still buffered rather than freezing at the vanished end.
      const oldest = recordings[0];
      return oldest ? { recording: oldest, offset: Math.max(0, (currentWall - oldest.startedAt) / 1000) } : null;
    }
    if (recordingMediaSeconds(recording) > info.endSeconds + 0.5) {
      return { recording, offset: Math.max(0, (currentWall - recording.startedAt) / 1000) };
    }
    const next = recordings[index + 1];
    if (next) return { recording: next, offset: Math.max(0, (currentWall - next.startedAt) / 1000) };
    return null;
  }

  function refreshFollow(sessionToken) {
    if (refreshing || recovering || pendingReveal || sessionToken !== replayToken || !replayActive) return;
    const front = frontVideo;
    if (!front) return;
    const info = loadedInfo.get(front);
    if (!info) return;
    const currentWall = info.baseWall + (Number(front.currentTime) || 0) * 1000;
    const cont = recordingToContinue(info, currentWall);
    if (!cont) return;
    const target = backVideo || otherReplayVideo(front);
    if (!target || target === front) return;
    refreshing = true;
    loadInto(target, cont.recording, cont.offset, sessionToken, (video, nextInfo) => {
      refreshing = false;
      showAsFront(video, nextInfo, sessionToken, front);
    }, () => {
      refreshing = false;
    });
  }

  function recoverReplay() {
    if (recovering || refreshing || !replayActive || replayPausedByUser || !frontVideo || pendingReveal) return;
    const front = frontVideo;
    const info = loadedInfo.get(front);
    if (!info) return;
    const currentWall = info.baseWall + (Number(front.currentTime) || 0) * 1000;
    const cont = recordingToContinue(info, currentWall)
      || { recording: info.recording, offset: Math.max(0, (currentWall - info.recording.startedAt) / 1000) };
    const sessionToken = replayToken;
    const target = backVideo || otherReplayVideo(front);
    if (!target || target === front) return;
    recovering = true;
    const loadId = loadInto(target, cont.recording, cont.offset, sessionToken, (video, nextInfo) => {
      recovering = false;
      showAsFront(video, nextInfo, sessionToken, null);
    }, () => { recovering = false; });
    if (!loadId) recovering = false;
  }

  function startReplayMonitor(sessionToken) {
    stopReplayMonitor();
    let lastMediaTime = frontVideo ? Number(frontVideo.currentTime) || 0 : 0;
    let lastProgressAt = performance.now();
    const watch = () => {
      if (sessionToken !== replayToken || !replayActive) return;
      const front = frontVideo;
      if (front && !replayPausedByUser) {
        const now = performance.now();
        const mediaTime = Number(front.currentTime) || 0;
        if (mediaTime > lastMediaTime + 0.02 || mediaTime < lastMediaTime - 0.1) {
          lastMediaTime = mediaTime;
          lastProgressAt = now;
        }
        const info = loadedInfo.get(front);
        if (info) {
          const nearEnd = mediaTime >= info.endSeconds - REPLAY_REFRESH_LEAD_SECONDS;
          const moreData = recordingMediaSeconds(info.recording) > info.endSeconds + 0.5
            || recordings.indexOf(info.recording) < recordings.length - 1;
          if (nearEnd && moreData && !refreshing) refreshFollow(sessionToken);
        }
        if (now - lastProgressAt >= REPLAY_STALL_TIMEOUT_MS) {
          lastProgressAt = now;
          recoverReplay();
          if (front !== frontVideo) return;
        }
      }
      replayMonitorTimer = woTimeout(watch, REPLAY_MONITOR_MS);
    };
    replayMonitorTimer = woTimeout(watch, REPLAY_MONITOR_MS);
  }

  function setReplayPaused(paused) {
    if (!replayActive) return;
    replayPausedByUser = !!paused;
    const video = frontVideo;
    if (replayPausedByUser) {
      stopReplayMonitor();
      if (video) { try { video.pause(); } catch (_) {} }
      syncNativePlaybackButton();
      return;
    }
    if (!video) { syncNativePlaybackButton(); return; }
    video.muted = true;
    let playPromise = null;
    try { playPromise = video.play(); } catch (_) { recoverReplay(); }
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(() => {
        if (replayActive && frontVideo === video && !replayPausedByUser) video.muted = savedMuted;
      }).catch(() => {
        if (!replayPausedByUser) recoverReplay();
      });
    } else {
      video.muted = savedMuted;
    }
    startReplayMonitor(replayToken);
    syncNativePlaybackButton();
  }

  function toggleReplayPlayback() {
    if (replayActive) setReplayPaused(!replayPausedByUser);
  }

  function recordingAtWall(wall) {
    if (!recordings.length) return null;
    for (let i = recordings.length - 1; i >= 0; i -= 1) {
      const recording = recordings[i];
      const end = recording.lastAt || recording.startedAt;
      if (wall >= recording.startedAt - 1 && wall <= end + 1500) {
        return { recording, offset: Math.max(0, (wall - recording.startedAt) / 1000) };
      }
    }
    if (wall < recordings[0].startedAt) return { recording: recordings[0], offset: 0 };
    const last = recordings[recordings.length - 1];
    return { recording: last, offset: Math.max(0, recordingMediaSeconds(last) - 0.2) };
  }

  function currentReplayAt() {
    if (!replayActive || !frontVideo) return NaN;
    const info = loadedInfo.get(frontVideo);
    if (!info) return NaN;
    return info.baseWall + Math.max(0, Number(frontVideo.currentTime) || 0) * 1000;
  }

  // twitch-adblock.js runs in the MAIN world and can see none of this file's
  // state. Publish "the viewer is deliberately behind live" on the document so
  // its post-ad catch-up seek stands down; otherwise that seek jumps the live
  // element we are recording and cuts the seconds out of the replay buffer.
  function markDeliberateRewind(active) {
    try {
      const root = document.documentElement;
      if (!root || typeof root.setAttribute !== 'function') return;
      if (active) root.setAttribute('data-wo-twitch-dvr', 'replay');
      else root.removeAttribute('data-wo-twitch-dvr');
    } catch (_) {}
  }

  function startReplayAt(targetWall) {
    if (!sourceVideo || !recordings.length) return;
    const range = availableRange();
    if (!range) return;
    const clampedWall = clamp(Number(targetWall) || range.endAt, range.startAt, range.endAt - 50);
    const at = recordingAtWall(clampedWall);
    if (!at) return;

    ensureReplayLayer();
    if (!replayLayer || replayVideos.length < 2) return;
    if (!replayActive) {
      replayPausedByUser = false;
      savedMuted = !!sourceVideo.muted;
      savedVolume = Number.isFinite(Number(sourceVideo.volume)) ? Number(sourceVideo.volume) : 1;
      sourceMuteOverridden = true;
    }
    const sessionToken = ++replayToken;
    replayActive = true;
    // Marked here, before any async load, so the signal cannot lag the user's
    // intent the way data-wardenone-active does (it only lands after a reveal).
    markDeliberateRewind(true);
    refreshing = false;
    recovering = false;
    stopReplayMonitor();
    cancelPendingReveal();
    sourceVideo.muted = true;
    resumeLiveSourceDuringReplay(sourceVideo, false);
    replayLayer.style.display = 'block';
    setPopoverOpen(false);

    const target = (frontVideo && backVideo && backVideo !== frontVideo)
      ? backVideo
      : (otherReplayVideo(frontVideo) || replayVideos[0]);
    const loadAt = (recording, offset) => loadInto(target, recording, offset, sessionToken, (video, info) => {
      showAsFront(video, info, sessionToken, null);
    }, () => {
      const index = recordings.indexOf(recording);
      const next = recordings[index + 1];
      if (next && next !== recording) {
        loadAt(next, 0);
      } else {
        statusError = 'The requested replay point could not be decoded';
        if (!frontVideo) goLive();
      }
    });
    loadAt(at.recording, at.offset);
  }

  function goLive() {
    replayToken += 1;
    replayActive = false;
    markDeliberateRewind(false);
    refreshing = false;
    recovering = false;
    replayPausedByUser = false;
    sourceResumeSerial += 1;
    sourceResumePending = false;
    lastTranslatedSourcePauseAt = 0;
    stopReplayMonitor();
    cancelPendingReveal();
    replayVideos.forEach(resetReplayVideo);
    frontVideo = null;
    backVideo = replayVideos[0] || null;
    if (replayLayer) {
      replayLayer.style.display = 'none';
      replayLayer.style.background = 'transparent';
    }
    if (sourceVideo && sourceMuteOverridden) {
      sourceVideo.muted = savedMuted;
      sourceVideo.volume = clamp(savedVolume, 0, 1);
    }
    sourceMuteOverridden = false;
    setPopoverOpen(false);
    syncNativePlaybackButton();
  }

  function removeReplayLayer() {
    replayToken += 1;
    replayActive = false;
    markDeliberateRewind(false);
    refreshing = false;
    recovering = false;
    replayPausedByUser = false;
    stopReplayMonitor();
    cancelPendingReveal();
    replayVideos.forEach(resetReplayVideo);
    if (replayLayer) replayLayer.remove();
    replayLayer = null;
    frontVideo = null;
    backVideo = null;
    replayVideos = [];
    replayUrls = new WeakMap();
    replayLoadControllers = new WeakMap();
    loadedInfo = new WeakMap();
  }

  function rewindBy(seconds) {
    const range = availableRange();
    if (!range) return;
    const from = replayActive && Number.isFinite(currentReplayAt()) ? currentReplayAt() : range.endAt;
    startReplayAt(from - Math.max(0, Number(seconds) || 0) * 1000);
  }

  function forwardBy(seconds) {
    const range = availableRange();
    if (!range) return;
    const base = replayActive && Number.isFinite(currentReplayAt()) ? currentReplayAt() : range.startAt;
    const target = base + Math.max(0, Number(seconds) || 0) * 1000;
    if (target >= range.endAt - LIVE_TOLERANCE_SECONDS * 1000) { goLive(); return; }
    startReplayAt(target);
  }

  function stepFrame(direction) {
    if (!replayActive || !frontVideo) return;
    if (!replayPausedByUser) setReplayPaused(true);
    const frame = 1 / 30;
    try {
      frontVideo.currentTime = Math.max(0, (Number(frontVideo.currentTime) || 0) + direction * frame);
    } catch (_) {}
  }

  // Playback speed doubles as the "gradual catch-up to live" control: pick >1x
  // and delayed playback eats into the delay until syncUi snaps it to live.
  function setReplayRate(rate) {
    replayRate = REPLAY_RATES.indexOf(rate) >= 0 ? rate : 1;
    if (replayActive && frontVideo) {
      try { frontVideo.playbackRate = replayRate; } catch (_) {}
    }
    updateSpeedButtons();
  }

  function updateSpeedButtons() {
    speedButtons.forEach((button) => {
      const on = Number(button.dataset.rate) === replayRate;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }

  function handleReplayShortcutKey(event) {
    if (!enabled || event.type !== 'keydown' || event.repeat || event.isComposing
      || event.ctrlKey || event.altKey || event.metaKey) return;
    if (editablePlaybackTarget(event.target)) return;
    const key = String(event.key || '').toLowerCase();
    const range = availableRange();
    const usable = !!range && range.duration >= MIN_REPLAY_SECONDS;
    if (key === 'arrowleft' || key === 'j') {
      if (!usable) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rewindBy(10);
    } else if (key === 'arrowright' || key === 'l') {
      if (!replayActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      forwardBy(10);
    } else if (key === ',' || key === '.') {
      if (!replayActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stepFrame(key === '.' ? 1 : -1);
    }
  }

  function previewSlider() {
    if (!slider || !previewText) return;
    const range = availableRange();
    if (!range) return;
    const position = clamp(Number(slider.value) || 0, 0, range.duration);
    const behind = range.duration - position;
    previewText.textContent = behind <= LIVE_TOLERANCE_SECONDS ? 'LIVE' : '-' + formatSeconds(behind);
    slider.style.setProperty('--position', (range.duration ? position / range.duration * 100 : 100).toFixed(2) + '%');
  }

  function seekFromSlider() {
    if (!slider || slider.disabled) return;
    const range = availableRange();
    if (!range) return;
    const position = clamp(Number(slider.value) || 0, 0, range.duration);
    startReplayAt(range.startAt + Math.min(position, Math.max(0, range.duration - 0.05)) * 1000);
  }

  function syncUi() {
    if (!enabled || !controlsRoot || !slider) return;
    // A backgrounded/occluded tab throttles capture, so the buffer stops growing.
    // Detect the gap (chunks stop arriving) so the UI can say so instead of
    // silently freezing the window.
    recordingStalled = !!(activeRecording && activeRecording.lastAt
      && sourceVideo && !sourceVideo.ended
      && performance.now() - activeRecording.lastAt > RECORDING_STALL_MS);
    if (isHarness) {
      controlsRoot.dataset.wardenoneHarnessState = JSON.stringify({
        recordings: recordings.length,
        bytes: totalBytes,
        recorder: activeRecording ? activeRecording.recorder.state : 'none',
        chunks: activeRecording ? activeRecording.chunks.length : 0,
        replayPaused: replayPausedByUser,
        replaySegment: frontVideo && loadedInfo.get(frontVideo) ? loadedInfo.get(frontVideo).recording.id : null,
        stalled: recordingStalled,
        rate: replayRate,
        bufferSeconds: bufferSeconds,
        maxRecordings: maxRecordings,
        error: statusError,
      });
    }
    const range = availableRange();
    const duration = range ? range.duration : 0;
    const replayAt = currentReplayAt();
    const behind = replayActive && range && Number.isFinite(replayAt)
      ? Math.max(0, (range.endAt - replayAt) / 1000)
      : 0;
    const usable = duration >= MIN_REPLAY_SECONDS;

    // Gradual catch-up: at >1x, delayed playback closes the gap; snap to live the
    // moment it arrives instead of overrunning past the buffer edge.
    if (replayActive && replayRate > 1 && range && Number.isFinite(replayAt) && !scrubbing
      && (range.endAt - replayAt) / 1000 <= LIVE_TOLERANCE_SECONDS) {
      goLive();
      return;
    }

    back10Button.disabled = !usable;
    back30Button.disabled = !usable;
    back60Button.disabled = !usable;
    back300Button.disabled = !usable;
    positionButton.disabled = !usable && !!statusError;
    positionButton.classList.toggle('behind', replayActive);
    positionText.textContent = replayActive ? '-' + formatSeconds(behind) : 'DVR';
    slider.disabled = !usable;
    slider.max = String(duration);
    controlsShadow.querySelector('.oldest').textContent = '-' + formatSeconds(duration) + ' available';
    liveButton.disabled = !replayActive;
    rowLiveButton.hidden = !replayActive;

    if (statusError) bufferText.textContent = statusError;
    else if (recordingStalled) bufferText.textContent = (document.hidden
      ? 'Buffer paused · tab in background · '
      : 'Buffer paused · waiting for video · ') + formatSeconds(duration) + ' held';
    else if (duration >= bufferSeconds - 2) bufferText.textContent = 'Ready · ' + qualityLabel() + ' · ' + formatSeconds(bufferSeconds);
    else bufferText.textContent = 'Building · ' + qualityLabel() + ' · ' + formatSeconds(duration) + ' / ' + formatSeconds(bufferSeconds);

    if (!scrubbing) {
      const position = replayActive && range && Number.isFinite(replayAt)
        ? clamp((replayAt - range.startAt) / 1000, 0, duration)
        : duration;
      slider.value = String(position);
      previewText.textContent = replayActive ? '-' + formatSeconds(behind) : 'LIVE';
      slider.style.setProperty('--position', (duration ? position / duration * 100 : 100).toFixed(2) + '%');
    }
    syncNativePlaybackButton();
  }

  // ---- Lifecycle ------------------------------------------------------------

  // Detach the current capture element WITHOUT discarding the buffered
  // recordings. Twitch swaps the <video> element on quality changes and many ad
  // breaks; a mid-channel swap must re-point the recorder, not wipe the rewind.
  function releaseSource() {
    if (sourceVideo) sourceVideo.removeEventListener('pause', keepSourcePlayingDuringReplay);
    sourceResumePending = false;
    // Stop the live recorder (its capture track died with the old element) but
    // keep every recording so rewind still works across the swap.
    recorderGeneration += 1;
    if (activeRecording) {
      activeRecording.intentionalStop = true;
      clearTimeout(activeRecording.stopWatchdog);
      activeRecording.stopWatchdog = 0;
      if (activeRecording.recorder && activeRecording.recorder.state !== 'inactive') {
        try { activeRecording.recorder.stop(); } catch (_) {}
      }
      activeRecording = null;
    }
    // Drop the capture reference but do NOT stop its tracks: Chromium can hand
    // back the same captureStream for a reused <video>, and stopping it would
    // permanently break re-capture. ensureCaptureStream() re-derives a live
    // stream from whichever element we attach next.
    captureStreamRef = null;
    sourceVideo = null;
  }

  // Full teardown: stop replay, drop the buffer, restore the live element. Used
  // only when the channel changes or the feature shuts down.
  function detachSource() {
    goLive();
    stopStreamTracks(captureStreamRef);
    releaseSource();
    teardownRecording();
    removeReplayLayer();
    statusError = '';
  }

  function attachSource(video) {
    if (!video || video === sourceVideo) return;
    releaseSource();
    sourceVideo = video;
    woOn(sourceVideo, 'pause', keepSourcePlayingDuringReplay);
    recorderGeneration += 1;
    if (!mimeType) mimeType = selectMimeType();
    ensureReplayLayer();
    mountControls();
    ensureRecording();
  }

  function scan(forceDiscovery) {
    if (!enabled) return;
    const nextRoute = routeChannelKey();
    if (nextRoute !== routeKey) {
      routeKey = nextRoute;
      detachSource(); // channel changed -> discard the buffer
    }
    if (!routeKey) {
      if (controlsRoot) controlsRoot.remove();
      return;
    }
    const sourceInvalid = !sourceVideo || !sourceVideo.isConnected || sourceVideo.ended;
    if (forceDiscovery || sourceInvalid) {
      const video = findPrimaryVideo();
      if (video && video !== sourceVideo) {
        attachSource(video); // element swap within the same channel keeps the buffer
      } else if (!video && sourceVideo && sourceInvalid) {
        releaseSource(); // element vanished (ad break); keep buffer, await the replacement
      }
    }
    if (sourceVideo) {
      mountControls();
      ensureReplayLayer();
      ensureRecording();
    }
  }

  function start() {
    if (scanTimer) return;
    createControls();
    ensurePlaybackControlStyle();
    scan();
    scanTimer = woInterval(scan, 1000);
    syncTimer = woInterval(syncUi, 500);
  }

  function shutdown() {
    clearInterval(scanTimer);
    clearInterval(syncTimer);
    scanTimer = 0;
    syncTimer = 0;
    detachSource();
    replayRate = 1;
    recordingStalled = false;
    routeKey = '';
    removeControls();
    if (playbackControlStyle) playbackControlStyle.remove();
    playbackControlStyle = null;
  }

  // The buffer length is user-configurable (twitchRewindMinutes). Derive the
  // time window, a scaled RAM ceiling, and how many recordings to retain so the
  // window is spanned; both are clamped so a large setting can't exhaust memory.
  function applyBufferConfig(minutes) {
    const requested = Math.round((Number(minutes) > 0 ? Number(minutes) : DEFAULT_BUFFER_SECONDS / 60) * 60);
    bufferSeconds = clamp(requested, MIN_BUFFER_SECONDS, MAX_BUFFER_SECONDS_CAP);
    bufferBytes = Math.min(MAX_BUFFER_BYTES_CAP, bufferSeconds * BUFFER_BYTES_PER_SECOND);
    maxRecordings = Math.max(2, Math.ceil(bufferSeconds / (REC_ROTATE_MS / 1000)) + 2);
    pruneRecordings();
  }

  function applyConfig(config) {
    applyBufferConfig(config && config.twitchRewindMinutes);
    const nextEnabled = !!(config && config.enabled !== false && config.twitchRewind === true);
    if (nextEnabled === enabled) return;
    enabled = nextEnabled;
    if (enabled) start();
    else shutdown();
  }

  woOn(document, 'fullscreenchange', () => woTimeout(() => scan(true), 0));
  woOn(document, 'click', handleNativePlaybackClick, true);
  woOn(document, 'keydown', handleNativePlaybackKey, true);
  woOn(document, 'keyup', handleNativePlaybackKey, true);
  woOn(document, 'keydown', handleReplayShortcutKey, true);
  woOn(document, 'click', (event) => {
    if (!popoverOpen || !controlsRoot) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (!path.includes(controlsRoot)) setPopoverOpen(false);
  }, true);
  try {
    chrome.storage.local.get('wardenone_config', (result) => applyConfig(result && result.wardenone_config));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.wardenone_config) applyConfig(changes.wardenone_config.newValue || {});
    });
  } catch (_) {}
  woOn(window, 'pagehide', shutdown, { once: true });
})();

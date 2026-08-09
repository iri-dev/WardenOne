/* Static safety and integration checks for the opt-in Twitch local DVR. */
'use strict';

const fs = require('fs');
const vm = require('vm');
/* This suite lifts the module's source into a hand-built sandbox. It now uses AbortController to
 * release its listeners on teardown, which a bare vm context does not provide. */
const { installPlatformGlobals } = require('./lib/engine-ambient.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error('[fail] ' + message);
    process.exit(1);
  }
}

const rewind = read('twitch-rewind.js');
const manifest = JSON.parse(read('manifest.json'));
const popup = read('popup.js');
const popupHtml = read('popup.html');
const background = read('background.js');
const harness = read('tools/twitch-rewind-harness.html');
const entry = manifest.content_scripts.find((item) => (item.js || []).includes('twitch-rewind.js'));
const removedMainEntry = manifest.content_scripts.find((item) => (item.js || []).includes('twitch-rewind-main.js'));
const rotationBlock = rewind.slice(rewind.indexOf('function rotateRecording'), rewind.indexOf('function stopRecorder'));
const recordingBlock = rewind.slice(rewind.indexOf('function startRecordingSession'), rewind.indexOf('function rotateRecording'));
const loadBlock = rewind.slice(rewind.indexOf('function loadInto'), rewind.indexOf('function scheduleBackReset'));
const vp8Index = rewind.indexOf('video/webm;codecs=vp8,opus');
const vp9Index = rewind.indexOf('video/webm;codecs=vp9,opus');

new vm.Script(rewind, { filename: 'twitch-rewind.js' });

// ---- Wiring & opt-in --------------------------------------------------------
assert(entry, 'manifest should load twitch-rewind.js');
assert(JSON.stringify(entry.matches) === JSON.stringify(['*://*.twitch.tv/*']), 'rewind should be scoped to Twitch');
assert(entry.all_frames === false && entry.world === 'ISOLATED', 'rewind should run once in an isolated world');
assert(!removedMainEntry, 'the broken MAIN-world SourceBuffer patch should not load');
assert(/twitchRewind:\s*false/.test(popup), 'popup default should be opt-in');
assert(/twitchRewind:\s*false/.test(background), 'install default should be opt-in');
assert(/config\.twitchRewind === true/.test(rewind), 'runtime should require explicit enablement');

// ---- Bounded high-quality buffer -------------------------------------------
assert(/const DEFAULT_BUFFER_SECONDS = 300;/.test(rewind), 'runtime should default to a five-minute buffer');
assert(/function applyBufferConfig/.test(rewind) && /config\.twitchRewindMinutes/.test(rewind), 'buffer length should be user-configurable');
assert(/MAX_BUFFER_SECONDS_CAP/.test(rewind) && /bufferBytes = Math\.min\(MAX_BUFFER_BYTES_CAP/.test(rewind), 'a custom buffer must be clamped by a hard time and RAM ceiling');
assert(/twitchRewindMinutes:\s*5/.test(popup) && /twitchRewindMinutes:\s*5/.test(background), 'the default buffer length should ship as five minutes');
// Moved out of AdShield into its own section, with a buffer-length control that discloses cost.
assert(/<details class="rewind-drop">/.test(popupHtml) && /<summary>Twitch local rewind/.test(popupHtml), 'rewind should be its own collapsible section, not under AdShield');
assert(/id="tr-minutes"/.test(popupHtml), 'the popup should expose a custom buffer-length control');
assert(/more RAM and CPU/.test(popupHtml), 'the popup should disclose that the feature uses more RAM and CPU');
assert(/MediaRecorder/.test(rewind) && /captureStream/.test(rewind), 'runtime should create the local replay buffer');
assert(/videoBitsPerSecond: videoBitrate\(sourceVideo\)/.test(rewind), 'recorder should use adaptive high-quality video bitrate');
assert(/return 16000000/.test(rewind) && /return 12000000/.test(rewind), 'high-resolution replay should use a visibly loss-resistant bitrate');
assert(vp8Index >= 0 && vp9Index >= 0 && vp8Index < vp9Index, 'recorder should prefer the lower-overhead VP8 codec');

// ---- Single continuous recorder (the core of the rewrite) ------------------
assert(/const CHUNK_MS = 1000;/.test(rewind), 'recording should emit continuous timeslice chunks');
assert(/recorder\.start\(CHUNK_MS\)/.test(recordingBlock), 'a single MediaRecorder should run continuously with a timeslice');
assert(!/SEGMENT_MS/.test(rewind), 'the old per-clip segment recorder must be gone');
assert(/requestVideoFrameCallback/.test(rewind) && /cancelVideoFrameCallback/.test(rewind), 'reveal should use requestVideoFrameCallback for the crispest cut on a composited tab');
assert(/function startRecordingSession/.test(rewind), 'a recording should be one uninterrupted MediaRecorder session');
assert(/recording\.chunks\.push\(\{ blob: event\.data/.test(rewind), 'continuous chunks should accumulate in order for concatenation');
assert(/track\.kind === 'video' && track\.readyState === 'live'/.test(rewind), 'capture reuse must require a live video track, not audio alone');

// ---- Rotation-based eviction (keeps memory bounded, not front-dropping) ----
assert(/const REC_ROTATE_MS =/.test(rewind) && /const REC_ROTATE_BYTES =/.test(rewind), 'the continuous recorder should rotate to bound each recording');
assert(/const ROTATE_OVERLAP_MS =/.test(rewind), 'rotation should overlap recorders so the seam is captured');
assert(rotationBlock.indexOf('startRecordingSession') >= 0 && rotationBlock.indexOf('startRecordingSession') < rotationBlock.indexOf('stopRecorder'),
  'rotation must start the successor before stopping the old recorder');
assert(/function pruneRecordings/.test(rewind) && /recordings\.shift\(\)/.test(rewind), 'eviction should drop whole aged-out recordings, never partial chunks');
assert(/totalBytes > bufferBytes/.test(rewind) && /bufferSeconds \* 1000/.test(rewind), 'eviction should honour both the byte and time budgets');
assert(/recordings\.length > maxRecordings/.test(rewind), 'recordings retained should scale with the configured buffer length');
assert(!/function pruneSegments/.test(rewind), 'the old per-clip pruning must be gone');

// ---- Single seekable-blob replay (no per-clip swap machinery) --------------
assert(/new Blob\(recording\.chunks\.map/.test(loadBlock), 'replay should concatenate a recording into one seekable blob');
assert(/video\.currentTime = Math\.max\(0, Number\(offsetSeconds\)/.test(loadBlock), 'replay should seek directly to the rewind target');
assert(!/1e10/.test(rewind), 'replay must not scan to end-of-file to seek (a continuous recording seeks accurately, and the scan added a visible hitch)');
assert(/replayVideos = \[createReplayVideo\(\), createReplayVideo\(\)\]/.test(rewind), 'replay should keep two surfaces for a seamless follow-live swap');
assert(/function revealWhenAdvancing/.test(rewind) && /function cancelPendingReveal/.test(rewind), 'a swapped-in surface must reveal only once it is presenting fresh frames, never a frozen seek');
// Matched on the event, not on how it is registered: the listener now goes through a helper so
// teardown can release it, which changed nothing about what the reveal gate watches.
assert(/REPLAY_REVEAL_CAP_MS/.test(rewind) && /'timeupdate'/.test(rewind), 'the reveal gate should watch playback progress with a hard fallback cap');
assert(/function refreshFollow/.test(rewind) && /function recordingToContinue/.test(rewind), 'delayed playback should follow live by refreshing the same continuous timeline');
assert(/showAsFront\(video, nextInfo, sessionToken, front\)/.test(rewind), 'a follow-live refresh should align the incoming surface to the outgoing position');
assert(/function recoverReplay/.test(rewind) && /REPLAY_STALL_TIMEOUT_MS/.test(rewind), 'a stalled or errored replay should recover instead of freezing');
assert(/REPLAY_MONITOR_MS/.test(rewind) && !/replayBoundaryRaf/.test(rewind), 'stall monitoring should use a low-frequency timer, not per-frame polling');
assert(/REPLAY_LOAD_TIMEOUT_MS/.test(rewind) && /replayLoadControllers/.test(rewind), 'replay loads should be cancellable and have a hard watchdog');
assert(/function setReplayPaused\(paused\)/.test(rewind) && /replayPausedByUser/.test(rewind), 'intentional pause must not be treated as a playback stall');
assert(/dataset\.wardenoneReplay/.test(rewind) && /video:not\(\[data-wardenone-replay\]\)/.test(rewind), 'replay surfaces must be excluded from live-video discovery');

// ---- Survive ad breaks / quality changes without wiping the buffer ----------
assert(/function releaseSource\(\)/.test(rewind) && /function detachSource\(\)/.test(rewind), 'element swap (releaseSource) must be separate from channel-change teardown (detachSource)');
assert(/releaseSource\(\);\s*sourceVideo = video;/.test(rewind), 'attachSource should keep the buffer (releaseSource, not detachSource) on an element swap');
assert(/else if \(!video && sourceVideo && sourceInvalid\) \{\s*releaseSource\(\);/.test(rewind), 'a vanished <video> (ad break) should keep the buffer and await the replacement');
assert(/detachSource\(\); \/\/ channel changed/.test(rewind), 'only a channel change should discard the buffer');

// ---- Cross-recording boundary (rotation) ------------------------------------
assert(/const ROTATE_OVERLAP_MS = 1000/.test(rewind), 'rotation should overlap enough to cross the boundary seamlessly');
assert(/isHarness \? 20000 : 180000/.test(rewind), 'the harness should rotate fast so the cross-recording boundary is exercised in tests');

// ---- Backgrounded-tab capture detection -------------------------------------
assert(/RECORDING_STALL_MS/.test(rewind) && /recordingStalled/.test(rewind), 'capture stalls (e.g. a background tab) should be detected');
assert(/tab in background/.test(rewind), 'a background-tab capture pause should be surfaced, not silently gapped');

// ---- Playback speed + gradual catch-up --------------------------------------
assert(/const REPLAY_RATES = \[1, 1.25, 1.5, 2\]/.test(rewind), 'playback speed presets should be available');
assert(/function setReplayRate/.test(rewind) && /frontVideo\.playbackRate = replayRate/.test(rewind), 'speed control should drive the replay playbackRate');
assert(/replayRate > 1 &&[\s\S]{0,160}?goLive\(\)/.test(rewind), 'above 1x, delayed playback should gradually catch up and snap to live');
assert(/class="spd"/.test(rewind) && /data-rate="1.5"/.test(rewind), 'the popover should expose speed buttons');

// ---- Keyboard shortcuts -----------------------------------------------------
assert(/function handleReplayShortcutKey/.test(rewind) && /handleReplayShortcutKey, true\)/.test(rewind), 'replay keyboard shortcuts should be wired');
assert(/'arrowleft' \|\| key === 'j'/.test(rewind) && /'arrowright' \|\| key === 'l'/.test(rewind), 'arrows and J/L should seek by ten seconds');
assert(/function stepFrame/.test(rewind) && /',' \|\| key === '\.'/.test(rewind), 'comma/period should frame-step');
assert(/if \(editablePlaybackTarget\(event\.target\)\) return;/.test(rewind), 'shortcuts must not fire while typing in chat or inputs');

// ---- Native player integration & UI ----------------------------------------
assert(/player-controls__left-control-group/.test(rewind), 'controls should mount in Twitch\'s native left control group');
assert(/player-mute-unmute-button/.test(rewind) && /insertAdjacentElement\('afterend'/.test(rewind), 'controls should mount immediately after Twitch volume');
assert(/aria-label="Rewind 1 minute"/.test(rewind) && /aria-label="Rewind 5 minutes"/.test(rewind), 'native control row should include one- and five-minute jumps');
// Same again: the button and what its click does are the assertion, not the registration call.
assert(/class="rowLive"/.test(rewind) && /rowLiveButton, 'click', goLive\)/.test(rewind), 'delayed playback should expose a persistent LIVE control');
assert(/input type="range"/.test(rewind), 'DVR popover should expose an arbitrary-position timeline');
assert(/handleNativePlaybackClick/.test(rewind) && /handleNativePlaybackKey/.test(rewind), 'Twitch click and keyboard playback controls should operate delayed replay');
assert(/data-wardenone-replay-paused/.test(rewind) && /syncNativePlaybackButton/.test(rewind), 'Twitch play control should visibly reflect delayed pause state');
assert(/video-player__overlay/.test(rewind) && /nextOverlay\.style\.zIndex = '20'/.test(rewind), 'Twitch controls should stay above the replay picture');
assert(/sourceVideo\.muted = true/.test(rewind), 'live audio should be silenced while local replay audio plays');

// ---- Browser harness still exercises the hard paths -------------------------
assert(/canvas width="1920" height="1080"/.test(harness) && /1000 \/ 60/.test(harness), 'browser harness should stress 1080p60 capture');
assert(/createMediaStreamDestination/.test(harness) && /data-current-time/.test(harness), 'browser harness should offer audio stress and expose playback progress');
assert(/nativePlaybackButton\.addEventListener\('click'/.test(harness) && /data-paused/.test(harness), 'browser harness should exercise native pause and expose paused state');

// ---- Cross-world DVR contract with the ad blocker ---------------------------
// twitch-adblock.js (MAIN world) stands its post-ad catch-up seek down while the
// viewer is deliberately behind. A rename on either side must fail here, not on
// a live rewind that silently loses seconds from the recording.
const adblock = read('twitch-adblock.js');
assert(/data-wo-twitch-dvr/.test(rewind) && /data-wo-twitch-dvr/.test(adblock),
  'the DVR replay signal must stay readable by the MAIN-world ad blocker');
assert(/replayActive = true;[\s\S]{0,300}?markDeliberateRewind\(true\);/.test(rewind),
  'the replay signal must be published on the same synchronous edge as replayActive');
assert((rewind.match(/markDeliberateRewind\(false\)/g) || []).length === 2,
  'both goLive and removeReplayLayer must clear the replay signal');
assert(/wardenone-twitch-replay-layer/.test(rewind) && /wardenone-twitch-replay-layer/.test(adblock),
  'the replay-layer fallback probe must keep matching the layer id');

// ---- Privacy / non-interference guarantees ---------------------------------
assert(!/SourceBuffer\.prototype/.test(rewind), 'runtime must not interfere with Twitch MediaSource eviction');
assert(!/sourceVideo\.currentTime\s*=/.test(rewind), 'runtime must not seek Twitch into discarded media');
assert(!/\bfetch\s*\(/.test(rewind), 'rewind must not fetch playlists or media');
assert(!/chrome\.downloads|indexedDB|chrome\.storage\.local\.set/.test(rewind), 'rewind must not persist media');
assert(!/PlaybackAccessToken|streamPlaybackAccessToken/.test(rewind), 'rewind must not manipulate playback entitlement');

// ---- Recovery is single-flight --------------------------------------------
// Exercise the real recoverReplay/loadInto closure with a deliberately slow
// fake media surface. Repeated monitor ticks must not cancel and restart the
// six-second load before its watchdog can settle it.
function createRecoveryHarness() {
  const hook = `
    window.__wardenOneRecoveryTest = {
      configure: function (front, back, recording) {
        replayToken = 1;
        replayActive = true;
        replayPausedByUser = false;
        refreshing = false;
        recovering = false;
        pendingReveal = null;
        frontVideo = front;
        backVideo = back;
        replayVideos = [front, back];
        recordings = [recording];
        loadedInfo.set(front, { recording: recording, endSeconds: 10, baseWall: recording.startedAt });
      },
      recover: recoverReplay,
      isRecovering: function () { return recovering; }
    };
  `;
  const instrumented = rewind.replace(/\}\)\(\);\s*$/, hook + '\n})();');
  const timers = new Map();
  const createdUrls = [];
  let timerId = 0;
  class HarnessURL extends URL {}
  HarnessURL.createObjectURL = function () {
    const value = 'blob:recovery-' + (createdUrls.length + 1);
    createdUrls.push(value);
    return value;
  };
  HarnessURL.revokeObjectURL = function () {};
  class HarnessBlob { constructor(parts, options) { this.parts = parts; this.type = options && options.type; } }
  const fakeWindow = {};
  fakeWindow.top = fakeWindow;
  fakeWindow.addEventListener = function () {};
  const context = {
    window: fakeWindow,
    location: { hostname: 'www.twitch.tv', pathname: '/fixture' },
    document: {
      documentElement: {},
      addEventListener: function () {},
      querySelectorAll: function () { return []; }
    },
    chrome: {
      storage: {
        local: { get: function (_key, callback) {
          callback({ wardenone_config: { enabled: true, twitchRewind: false } });
        } },
        onChanged: { addListener: function () {} }
      }
    },
    URL: HarnessURL,
    Blob: HarnessBlob,
    performance: { now: function () { return 5000; } },
    setTimeout: function (callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: function (id) { timers.delete(id); },
    setInterval: function () { return 1; },
    clearInterval: function () {},
    console: { info: function () {} }
  };
  context.globalThis = context;
  installPlatformGlobals(context);
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'twitch-rewind.js:recovery' });

  function fakeVideo(currentTime) {
    return {
      currentTime: currentTime || 0,
      readyState: 0,
      dataset: {},
      style: {},
      loadCalls: 0,
      addEventListener: function () {},
      removeEventListener: function () {},
      removeAttribute: function (name) { if (name === 'src') delete this.src; },
      pause: function () {},
      load: function () { this.loadCalls += 1; }
    };
  }

  return {
    api: fakeWindow.__wardenOneRecoveryTest,
    front: fakeVideo(5),
    back: fakeVideo(0),
    recording: {
      id: 1,
      mimeType: 'video/webm',
      startedAt: 1000,
      lastAt: 20000,
      chunks: [{ blob: { size: 10 } }]
    },
    createdUrls,
    runLoadTimeout: function () {
      const entry = Array.from(timers.entries()).find((item) => item[1].delay === 6000);
      if (!entry) return false;
      timers.delete(entry[0]);
      entry[1].callback();
      return true;
    }
  };
}

const recoveryHarness = createRecoveryHarness();
recoveryHarness.api.configure(recoveryHarness.front, recoveryHarness.back, recoveryHarness.recording);
recoveryHarness.api.recover();
recoveryHarness.api.recover();
recoveryHarness.api.recover();
assert(recoveryHarness.createdUrls.length === 1,
  'repeated recovery ticks restarted a pending replay load');
assert(recoveryHarness.api.isRecovering(), 'recovery latch was not held while the replay load was pending');
assert(recoveryHarness.runLoadTimeout(), 'focused recovery harness did not install the six-second watchdog');
assert(!recoveryHarness.api.isRecovering(), 'recovery latch did not clear after load failure');
recoveryHarness.api.recover();
assert(recoveryHarness.createdUrls.length === 2,
  'a settled recovery prevented a later recovery attempt');

console.log('[ok] Twitch rewind safety checks passed');

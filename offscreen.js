/* Audio is deliberately generated locally so WardenOne does not need remote media
 * or a collection of opaque packaged sound files. It is only reached after an
 * explicit opt-in or a preview button click.
 *
 * The tunes themselves live in notification-schema.js, with the settings page and
 * the worker's validator, because three copies of the list is three chances for
 * the page to offer a sound the player does not know and the reader to press
 * preview and hear nothing.
 */
let wardenAudioContext = null;

/* The context lives for a sound, not for the session (LIFE-05). It used to be created lazily
   and kept for as long as this document lived -- which, before the worker learned to close the
   document, was the rest of the browser session. Once the last scheduled note has ended and a
   short idle has passed, the context is closed and dropped; the next tune makes a new one
   (playTone already treats a closed context as absent). The worker closes the document itself
   a moment later; this keeps no audio graph alive in the meantime. */
const WARDEN_AUDIO_IDLE_MS = 2000;
let wardenAudioIdleTimer = 0;

function releaseAudioContextWhenIdle(tuneSeconds) {
  if (wardenAudioIdleTimer) clearTimeout(wardenAudioIdleTimer);
  wardenAudioIdleTimer = setTimeout(() => {
    wardenAudioIdleTimer = 0;
    const context = wardenAudioContext;
    wardenAudioContext = null;
    if (!context || context.state === 'closed') return;
    try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
  }, Math.ceil(Math.max(0, Number(tuneSeconds) || 0) * 1000) + WARDEN_AUDIO_IDLE_MS);
}

function soundSpec(sound) {
  /* 'notification' is the name the first version used for what is now 'soft'.
     Settings saved then still say it, so it keeps working. */
  const wanted = String(sound || '') === 'notification' ? 'soft' : String(sound || '');
  const found = (typeof wardenNotificationSound === 'function') ? wardenNotificationSound(wanted) : null;
  if (found) return found;
  return (typeof wardenNotificationSound === 'function' && wardenNotificationSound('soft'))
    || { id: 'soft', notes: [659.25, 830.61], wave: 'sine', gap: 0.105,
      length: 0.25, attack: 0.012, level: 0.13,
      layers: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'triangle', ratio: 2, gain: 0.065 }] };
}

function toneNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function oscillatorWave(value, fallback) {
  const wave = String(value || '');
  return /^(?:sine|triangle|square|sawtooth)$/.test(wave) ? wave : fallback;
}

async function playTone(sound, volume) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return false;
  const spec = soundSpec(sound);
  if (!spec || !spec.notes || !spec.notes.length) return false;
  if (!wardenAudioContext || wardenAudioContext.state === 'closed') wardenAudioContext = new AudioContextClass();
  if (wardenAudioContext.state === 'suspended') await wardenAudioContext.resume();
  if (wardenAudioContext.state !== 'running') return false;

  const start = wardenAudioContext.currentTime + 0.02;
  const gap = toneNumber(spec.gap, 0.12, 0.04, 0.5);
  const length = toneNumber(spec.length, Math.max(0.12, gap), 0.08, 0.7);
  const attack = toneNumber(spec.attack, 0.012, 0.003, Math.min(0.08, length / 2));
  const level = toneNumber(spec.level, 0.1, 0.02, 0.18);
  const glide = toneNumber(spec.glide, 1, 0.85, 1.15);
  const primaryWave = oscillatorWave(spec.wave, 'sine');
  const layers = Array.isArray(spec.layers) && spec.layers.length ? spec.layers : [{ wave: primaryWave, ratio: 1, gain: 1 }];
  let output = wardenAudioContext.destination;
  if (typeof wardenAudioContext.createBiquadFilter === 'function') {
    const filter = wardenAudioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(toneNumber(spec.filterHz, 4200, 800, 12000), start);
    filter.Q.setValueAtTime(0.55, start);
    filter.connect(output);
    output = filter;
  }
  spec.notes.forEach((frequency, index) => {
    const at = start + index * gap;
    const noteLevel = toneNumber(spec.noteLevels && spec.noteLevels[index], 1, 0.2, 1.25);
    const peak = Math.max(0.0001, volume * level * noteLevel);
    const noteGain = wardenAudioContext.createGain();
    noteGain.gain.setValueAtTime(0.0001, at);
    noteGain.gain.exponentialRampToValueAtTime(peak, at + attack);
    noteGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.42), at + length * 0.58);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    noteGain.connect(output);

    layers.forEach((layer) => {
      const oscillator = wardenAudioContext.createOscillator();
      const layerGain = wardenAudioContext.createGain();
      const ratio = toneNumber(layer && layer.ratio, 1, 0.25, 4);
      const layerLevel = toneNumber(layer && layer.gain, 1, 0.01, 1.25);
      const pitch = toneNumber(frequency, 660, 80, 5000) * ratio;
      oscillator.type = oscillatorWave(layer && layer.wave, primaryWave);
      oscillator.frequency.setValueAtTime(pitch, at);
      if (glide !== 1 && typeof oscillator.frequency.exponentialRampToValueAtTime === 'function') {
        oscillator.frequency.exponentialRampToValueAtTime(pitch * glide, at + length);
      }
      layerGain.gain.setValueAtTime(layerLevel, at);
      oscillator.connect(layerGain);
      layerGain.connect(noteGain);
      oscillator.start(at);
      oscillator.stop(at + length + 0.02);
    });
  });
  releaseAudioContextWhenIdle(0.04 + (spec.notes.length - 1) * gap + length);
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'wardenone-offscreen' || message.type !== 'play-notification-sound') return false;
  const volume = Math.max(0, Math.min(1, Number(message.volume) || 0));
  playTone(message.sound, volume).then(
    (played) => sendResponse(played === true ? { ok: true } : { ok: false, error: 'Audio is unavailable.' }),
    () => sendResponse({ ok: false, error: 'Audio playback failed.' })
  );
  return true;
});

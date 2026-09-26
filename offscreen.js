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
    || { id: 'soft', notes: [660, 880], wave: 'sine', gap: 0.14 };
}

async function playTone(sound, volume) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;
  const spec = soundSpec(sound);
  if (!spec || !spec.notes || !spec.notes.length) return;
  if (!wardenAudioContext || wardenAudioContext.state === 'closed') wardenAudioContext = new AudioContextClass();
  if (wardenAudioContext.state === 'suspended') await wardenAudioContext.resume();

  const start = wardenAudioContext.currentTime + 0.02;
  const gap = Number(spec.gap) || 0.14;
  spec.notes.forEach((frequency, index) => {
    const oscillator = wardenAudioContext.createOscillator();
    const gain = wardenAudioContext.createGain();
    const at = start + index * gap;
    oscillator.type = spec.wave || 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.16), at + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + gap - 0.02);
    oscillator.connect(gain);
    gain.connect(wardenAudioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + gap);
  });
  releaseAudioContextWhenIdle(0.02 + spec.notes.length * gap);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'wardenone-offscreen' || message.type !== 'play-notification-sound') return false;
  const volume = Math.max(0, Math.min(1, Number(message.volume) || 0));
  playTone(message.sound, volume).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

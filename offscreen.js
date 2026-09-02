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
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'wardenone-offscreen' || message.type !== 'play-notification-sound') return false;
  const volume = Math.max(0, Math.min(1, Number(message.volume) || 0));
  playTone(message.sound, volume).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

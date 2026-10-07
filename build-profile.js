/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The build profile: which of WardenOne's separable utilities this package carries (CWS-03).
 *
 * WardenOne's Store purpose is protective browsing with reader control over page presentation
 * and resource use. EyeShield supports readability; Memory Shield releases resources used by
 * inactive tabs, and Tab Limit is part of that resource control. The Store decision for each
 * feature is explicit below.
 *
 * tools/build-store-package.js sets `profile` to `store` and strips omitted utility entries
 * from the packaged copy; in the repository the profile says `full` and carries every utility.
 * `features` is the decision record: each utility with its Store decision and everything it would carry. The
 * worker imports this file, the popup loads it, and both degrade a missing feature to "not in this
 * build" rather than to an error. docs/store-single-purpose.md is generated from this table.
 */

const WARDENONE_BUILD = Object.freeze({
  // BUILD-PROFILE-BEGIN (rewritten by tools/build-store-package.js; the repository copy is the full build)
  profile: 'full',
  omitted: Object.freeze([]),
  // BUILD-PROFILE-END
  features: Object.freeze({
    eyeShield: Object.freeze({
      label: 'EyeShield',
      store: 'include',
      goal: 'Reader-controlled page presentation for readability and visual comfort: brightness, contrast, warmth, saturation and grayscale.',
      files: Object.freeze(['eyeshield.js', 'eyeshield-bootstrap.js', 'eyeshield-profiles.js', 'eyeshield-sites.js', 'eyeshield-preload-dark.js', 'eyeshield-preload-ultra.js', 'eyeshield-preload-light.js']),
      keys: Object.freeze([
        'eyeShield', 'eyeShieldMode', 'eyeShieldBrightness', 'eyeShieldBrightnessByHost', 'eyeShieldContrast',
        'eyeShieldContrastByHost', 'eyeShieldSaturation', 'eyeShieldSaturationByHost', 'eyeShieldWarmth',
        'eyeShieldWarmthByHost', 'eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 'eyeShieldSites',
      ]),
      messages: Object.freeze([]),
      popupSections: Object.freeze(['EyeShield']),
    }),
    memoryShield: Object.freeze({
      label: 'Memory Shield',
      store: 'include',
      goal: 'Resource protection: discard eligible idle tabs, reduce optional page work, and keep safeguards for active work and media.',
      files: Object.freeze(['background-memory.js', 'resource-saver.js']),
      keys: Object.freeze([
        'memoryShield', 'memoryMode', 'memoryMinutesOverride', 'memoryNeverPinned', 'memoryNeverAudio',
        'memoryNeverForms', 'memoryNeverPayment', 'memoryNeverSleepHosts', 'disableYouTubeAmbientMode', 'stopAnimatedVideoPreviews',
        'webglSaverMode', 'webglSaverBlockHosts', 'webglSaverAllowHosts',
      ]),
      messages: Object.freeze(['memory-']),
      popupSections: Object.freeze(['Memory Shield']),
    }),
    tabLimit: Object.freeze({
      label: 'Tab Limit',
      store: 'include',
      goal: 'Memory Shield control: when an optional tab cap is reached, sleep an eligible idle tab or close one if the reader opts in.',
      // Implemented inside background-memory.js; its own switch and settings, no file of its own.
      files: Object.freeze([]),
      keys: Object.freeze(['tabLimitGuard', 'tabLimitMax', 'tabLimitClose', 'tabLimitMinIdleMinutes', 'tabLimitWarn']),
      messages: Object.freeze([]),
      popupSections: Object.freeze([]),
    }),
    // STORE-OMIT-TWITCH-BEGIN
    twitchRewind: Object.freeze({
      label: 'Twitch Rewind',
      store: 'omit',
      goal: 'Local replay of a live Twitch stream: a rewind buffer and a jump to the in-progress recording.',
      files: Object.freeze(['twitch-rewind.js', 'twitch-vod-rewind.js']),
      keys: Object.freeze(['twitchRewind', 'twitchRewindMinutes', 'twitchVodRewind']),
      messages: Object.freeze([]),
      popupSections: Object.freeze([]),
    }),
    // STORE-OMIT-TWITCH-END
  }),
});

/* git archive fills this for GitHub ZIPs; unpacked source and Store packages keep the marker. */
const WARDENONE_SOURCE_COMMIT = '$Format:%H$';
function woSourceCommit() {
  return /^[0-9a-f]{40}$/.test(WARDENONE_SOURCE_COMMIT) ? WARDENONE_SOURCE_COMMIT : '';
}

function woFeatureOmitted(id) {
  return WARDENONE_BUILD.omitted.indexOf(String(id || '')) !== -1;
}

/* Every file the omitted features would have carried: what the package integrity check must not
   ask for, and what the Store tool removes. */
function woOmittedFiles() {
  const out = [];
  for (const id of WARDENONE_BUILD.omitted) {
    const feature = WARDENONE_BUILD.features[id];
    if (feature) feature.files.forEach((f) => { if (out.indexOf(f) === -1) out.push(f); });
  }
  return out;
}

function woOmittedKeys() {
  const out = [];
  for (const id of WARDENONE_BUILD.omitted) {
    const feature = WARDENONE_BUILD.features[id];
    if (feature) feature.keys.forEach((k) => { if (out.indexOf(k) === -1) out.push(k); });
  }
  return out;
}

/* True when a message kind belongs to a feature this package does not carry, so the worker can
   answer "not in this build" instead of reaching for a function that was never loaded. */
function woOmittedMessage(kind) {
  const k = String(kind || '');
  for (const id of WARDENONE_BUILD.omitted) {
    const feature = WARDENONE_BUILD.features[id];
    if (feature && feature.messages.some((prefix) => k.indexOf(prefix) === 0)) return true;
  }
  return false;
}

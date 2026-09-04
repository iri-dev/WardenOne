/* WardenOne notification settings and event catalogue.
 * Shared by the service worker and Notification Centre page. */

var WARDEN_NOTIFICATION_SECTIONS = [
  { id: 'security', label: 'Security', description: 'Threats, dangerous actions and credential protection' },
  { id: 'privacy', label: 'Privacy', description: 'Trackers, fingerprinting and network privacy' },
  { id: 'wardenone', label: 'WardenOne', description: 'Updates, extension changes and protection health' },
];

/* The sound palette, defined once.
 *
 * These are generated with oscillators rather than shipped as audio files: no
 * opaque binaries in the package, nothing to download, and nothing that can be
 * swapped for something else. The cost is that a "sound" here is a little tune,
 * so each one has to be distinguishable by SHAPE as well as pitch -- rising or
 * falling, one note or three, smooth or hard-edged. Six that differ only in
 * frequency would be six sounds nobody can tell apart.
 *
 * One list, shared by the settings page, the worker's validator and the
 * offscreen player. Three copies of it would be three chances for the page to
 * offer a sound the worker rejects and the reader hears nothing from.
 */
var WARDEN_NOTIFICATION_SOUNDS = [
  { id: 'none', label: 'Silent', notes: [], wave: 'sine', gap: 0 },
  /* One short high note. The least interruptive thing that is still audible. */
  { id: 'blip', label: 'Blip', notes: [880], wave: 'sine', gap: 0.13 },
  /* Two rising notes -- the current default, kept under its own name. */
  { id: 'soft', label: 'Soft', notes: [660, 880], wave: 'sine', gap: 0.14 },
  /* A major triad going up. Reads as "something finished", not "something is wrong". */
  { id: 'chime', label: 'Chime', notes: [523, 659, 784], wave: 'sine', gap: 0.12 },
  /* Two falling notes. Falling is the whole signal: it reads as a problem. */
  { id: 'warning', label: 'Warning', notes: [440, 370], wave: 'sine', gap: 0.14 },
  /* Three falling notes on a harder waveform -- more insistent than warning,
     short of the alarm. */
  { id: 'alert', label: 'Alert', notes: [587, 494, 415], wave: 'triangle', gap: 0.13 },
  /* Square wave, down and back up. Deliberately the least pleasant one here. */
  { id: 'critical', label: 'Critical', notes: [310, 246, 310], wave: 'square', gap: 0.14 },
];

function wardenNotificationSoundIds() {
  return WARDEN_NOTIFICATION_SOUNDS.map(function (entry) { return entry.id; });
}

function wardenNotificationSound(id) {
  var wanted = String(id || '');
  for (var i = 0; i < WARDEN_NOTIFICATION_SOUNDS.length; i++) {
    if (WARDEN_NOTIFICATION_SOUNDS[i].id === wanted) return WARDEN_NOTIFICATION_SOUNDS[i];
  }
  return null;
}

var WARDEN_NOTIFICATION_RULES = {
  dangerous_site: {
    section: 'security', label: 'Dangerous website detected',
    description: 'Phishing, malware, scam and high-confidence site warnings',
    icon: 'shield', severity: 'critical', enabled: true, mode: 'toast', duration: 'default', sound: 'critical',
  },
  dangerous_link: {
    section: 'security', label: 'Dangerous link or form blocked',
    description: 'Unsafe destinations, forms and paste targets',
    icon: 'link', severity: 'warning', enabled: true, mode: 'toast', duration: '10000', sound: 'warning',
  },
  password_exposure: {
    section: 'security', label: 'Password or credential exposure',
    description: 'Exposed passwords, token leaks and form-skimmer activity',
    icon: 'key', severity: 'critical', enabled: true, mode: 'toast', duration: 'default', sound: 'critical',
  },
  clickfix_clipboard: {
    section: 'security', label: 'ClickFix and clipboard protection',
    description: 'Clipboard replacement, command-paste and fake verification tricks',
    icon: 'clipboard', severity: 'critical', enabled: true, mode: 'toast', duration: 'default', sound: 'critical',
  },
  suspicious_download: {
    section: 'security', label: 'Suspicious download',
    description: 'Downloads that need a decision or were assessed as risky',
    icon: 'download', severity: 'critical', enabled: true, mode: 'toast', duration: 'default', sound: 'warning',
  },
  suspicious_redirect: {
    section: 'security', label: 'Popup or redirect prevented',
    description: 'Forced navigation, popup tricks and trapped-page behaviour',
    icon: 'redirect', severity: 'warning', enabled: true, mode: 'toast', duration: '10000', sound: 'warning',
  },
  tracker_blocked: {
    section: 'privacy', label: 'Tracker or beacon blocked',
    description: 'Routine tracker, beacon, cookie and social-widget activity',
    icon: 'eye', severity: 'info', enabled: true, mode: 'history', duration: '3000', sound: 'none',
  },
  fingerprinting_prevented: {
    section: 'privacy', label: 'Fingerprinting prevented',
    description: 'Browser fingerprint probes and fingerprinting scripts',
    icon: 'fingerprint', severity: 'info', enabled: true, mode: 'toast', duration: '5000', sound: 'notification',
  },
  ip_privacy: {
    section: 'privacy', label: 'IP and privacy protection',
    description: 'IP loggers, WebRTC, location and device-access warnings',
    icon: 'globe', severity: 'warning', enabled: true, mode: 'toast', duration: '5000', sound: 'none',
  },
  protection_list_updated: {
    section: 'wardenone', label: 'Protection lists updated',
    description: 'Fresh protection rules were downloaded and activated',
    icon: 'refresh', severity: 'success', enabled: true, mode: 'history', duration: 'default', sound: 'notification',
  },
  extension_changed: {
    section: 'wardenone', label: 'Installed extension changed',
    description: 'An extension gained access, changed version or needs review',
    icon: 'extension', severity: 'warning', enabled: true, mode: 'toast', duration: '10000', sound: 'warning',
  },
  protection_failure: {
    section: 'wardenone', label: 'Protection failure or degraded state',
    description: 'A WardenOne component failed, was disabled or rejected unsafe data',
    icon: 'error', severity: 'critical', enabled: true, mode: 'toast', duration: 'default', sound: 'critical',
  },
  experimental_warning: {
    section: 'wardenone', label: 'Experimental feature warning',
    description: 'Important behaviour from features marked experimental',
    icon: 'flask', severity: 'warning', enabled: true, mode: 'history', duration: 'default', sound: 'warning',
  },
  /* Results of a check the reader explicitly asked for. Kept a category like
     everything else so it can be retimed or silenced, but it defaults to a toast
     rather than history: somebody who right-clicks and asks a question is owed a
     visible answer, including "nothing found". */
  manual_check: {
    section: 'wardenone', label: 'Result of a check you asked for',
    description: 'Answers from Check this link, Check this text and Check this frame',
    icon: 'search', severity: 'info', enabled: true, mode: 'toast', duration: '10000', sound: 'none',
  },
  system_message: {
    section: 'wardenone', label: 'WardenOne system message',
    description: 'Startup checks, memory actions and routine maintenance',
    icon: 'settings', severity: 'info', enabled: true, mode: 'history', duration: 'default', sound: 'notification',
  },
};

function wardenNotificationClone(value, fallback) {
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; }
}

function wardenNotificationDefaultSettings() {
  var rules = {};
  Object.keys(WARDEN_NOTIFICATION_RULES).forEach(function (id) {
    var definition = WARDEN_NOTIFICATION_RULES[id];
    rules[id] = {
      enabled: definition.enabled !== false,
      mode: definition.mode,
      duration: definition.duration,
      sound: definition.sound,
    };
  });
  return {
    version: 4,
    defaultDuration: 'reading',
    position: 'top-right',
    retentionDays: 30,
    groupSimilar: true,
    badgeEnabled: false,
    soundEnabled: false,
    soundMode: 'important',
    volume: 0.55,
    rules: rules,
  };
}

var WARDEN_NOTIFICATION_DEFAULTS = wardenNotificationDefaultSettings();

function sanitizeWardenNotificationSettings(raw) {
  var source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var out = wardenNotificationDefaultSettings();
  var legacyDefaults = Number(source.version || 0) < 3;
  var legacyToolbarBadge = Number(source.version || 0) < 4;
  var legacyPersistent = new Set(['dangerous_site', 'password_exposure', 'clickfix_clipboard', 'suspicious_download', 'protection_failure']);
  var durations = new Set(['reading', '3000', '5000', '10000', '15000', 'persistent']);
  var ruleDurations = new Set(['default', '3000', '5000', '10000', '15000', 'persistent']);
  var positions = new Set(['top-right', 'top-left', 'bottom-right', 'bottom-left']);
  var modes = new Set(['history', 'toast', 'persistent']);
  var sounds = new Set(wardenNotificationSoundIds().concat(['notification']));
  var soundModes = new Set(['all', 'important', 'critical', 'none']);
  var retention = Number(source.retentionDays);

  if (durations.has(String(source.defaultDuration || ''))
      && !(legacyDefaults && String(source.defaultDuration) === '5000')) {
    out.defaultDuration = String(source.defaultDuration);
  }
  if (positions.has(String(source.position || ''))) out.position = String(source.position);
  if ([0, 1, 7, 30].includes(retention)) out.retentionDays = retention;
  out.groupSimilar = source.groupSimilar !== false;
  out.badgeEnabled = legacyToolbarBadge ? false : source.badgeEnabled === true;
  out.soundEnabled = source.soundEnabled === true;
  if (soundModes.has(String(source.soundMode || ''))) out.soundMode = String(source.soundMode);
  if (Number.isFinite(Number(source.volume))) out.volume = Math.max(0, Math.min(1, Number(source.volume)));

  var incomingRules = source.rules && typeof source.rules === 'object' ? source.rules : {};
  Object.keys(out.rules).forEach(function (id) {
    var incoming = incomingRules[id] && typeof incomingRules[id] === 'object' ? incomingRules[id] : null;
    if (!incoming) return;
    out.rules[id].enabled = incoming.enabled !== false && String(incoming.mode || '') !== 'off';
    var oldPersistentDefault = legacyDefaults && legacyPersistent.has(id)
      && String(incoming.mode || '') === 'persistent' && String(incoming.duration || '') === 'persistent';
    if (!oldPersistentDefault && modes.has(String(incoming.mode || ''))) out.rules[id].mode = String(incoming.mode);
    if (!oldPersistentDefault && ruleDurations.has(String(incoming.duration || ''))) out.rules[id].duration = String(incoming.duration);
    if (sounds.has(String(incoming.sound || ''))) out.rules[id].sound = String(incoming.sound);
  });

  /* Migrate the first category-only prototype without throwing away a user's
   * choices. New per-notification rules take precedence when present. */
  if (!source.rules && source.categories && typeof source.categories === 'object') {
    var legacySection = { security: 'security', privacy: 'privacy', downloads: 'security', extensions: 'wardenone', system: 'wardenone', activity: 'wardenone' };
    Object.keys(out.rules).forEach(function (id) {
      var definition = WARDEN_NOTIFICATION_RULES[id];
      var legacyKey = Object.keys(legacySection).find(function (key) { return legacySection[key] === definition.section; });
      if (id === 'suspicious_download') legacyKey = 'downloads';
      if (id === 'extension_changed') legacyKey = 'extensions';
      var incoming = legacyKey && source.categories[legacyKey];
      if (!incoming || typeof incoming !== 'object') return;
      var mode = String(incoming.mode || '');
      if (mode === 'off') out.rules[id].enabled = false;
      else if (modes.has(mode)) out.rules[id].mode = mode;
      if (ruleDurations.has(String(incoming.duration || ''))) out.rules[id].duration = String(incoming.duration);
      var legacySound = String(incoming.sound || '').replace(/^soft$/, 'notification');
      if (sounds.has(legacySound)) out.rules[id].sound = legacySound;
    });
  }
  return out;
}

function wardenNotificationRuleForType(type) {
  var value = String(type || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(WARDEN_NOTIFICATION_RULES, value)) return value;
  if (/download/.test(value)) return 'suspicious_download';
  if (/extension|permission_change/.test(value)) return 'extension_changed';
  /* list_integrity moved OUT of protection_failure.
     It is raised when an upstream list looks off -- bigger than its cap, drifted
     a long way from last time, or simply stale -- and in every one of those
     cases WardenOne keeps the list it already had and carries on. Protection is
     not failing; an update was refused. Filed under protection_failure it
     inherited critical + persistent, so one refused update from a filter host
     put "Protection failure or degraded state" on screen and left it there. */
  if (/engine_disabled|protection_failure|degraded|repair_failed|component_error/.test(value)) return 'protection_failure';
  if (/list_integrity|protection_list_updated|list_updated|rules_updated/.test(value)) return 'protection_list_updated';
  if (/manual_check|manual-check/.test(value)) return 'manual_check';
  if (/experimental/.test(value)) return 'experimental_warning';
  if (/clipboard|clickfix|command_paste|paste_protection/.test(value)) return 'clickfix_clipboard';
  /* The additions below are not cosmetic. Anything that reaches the fallback is
     filed as a system message, and system messages are history-only -- so every
     type that fell through here stopped being shown at all the day the centre
     shipped. Fifteen did, four of them High: a fake sign-in window, a spoofed
     address bar, hardware read without a prompt, and file access carried over
     from an earlier visit. They were all ordinary toasts before. */
  if (/password|credential|token|skimmer|payment|honeytoken|insecure_login|new_domain_login|login_thirdparty/.test(value)) return 'password_exposure';
  if (/safe_browsing_(link|form|paste)|dangerous_link|url_reputation|shortener/.test(value)) return 'dangerous_link';
  if (/phish|malware|cryptominer|techsupport|fake_update|fake_window|fullscreen_spoof|notification_scam|abuseipdb|form_trap|xss|behavioral_risk|certificate|http_only/.test(value)) return 'dangerous_site';
  /* blocked_hidden_media is spelled out: a bare hidden_media would also swallow
     warned_hidden_media_capture, which belongs to the privacy rule below. */
  if (/popup|redirect|meta_refresh|back_trap|confirm_bait|reload_loop|overlay_ad_frame|frame_top|gestureless_nav|app_install|notification_bait|autoplay_media|blocked_hidden_media/.test(value)) return 'suspicious_redirect';
  if (/fingerprint/.test(value)) return 'fingerprinting_prevented';
  if (/grabber|ip_lookup|webrtc|geolocation|media_capture|screen_capture|speech_capture|device_|file_|service_worker/.test(value)) return 'ip_privacy';
  if (/tracker|beacon|cookie|social_widget|supercookie|storage_access|logger_api|idle_watch|keystroke/.test(value)) return 'tracker_blocked';
  return 'system_message';
}

function wardenNotificationDefinition(ruleId) {
  return WARDEN_NOTIFICATION_RULES[ruleId] || WARDEN_NOTIFICATION_RULES.system_message;
}

function wardenNotificationResolvedPreference(settings, type) {
  var sane = sanitizeWardenNotificationSettings(settings);
  var ruleId = wardenNotificationRuleForType(type);
  var definition = wardenNotificationDefinition(ruleId);
  var rule = sane.rules[ruleId] || {
    enabled: definition.enabled !== false,
    mode: definition.mode,
    duration: definition.duration,
    sound: definition.sound,
  };
  var mode = rule.enabled === false ? 'off' : rule.mode;
  var duration = String(rule.duration || 'default') === 'default' ? sane.defaultDuration : String(rule.duration);
  return {
    settings: sane,
    ruleId: ruleId,
    definition: definition,
    rule: rule,
    mode: mode,
    duration: duration,
    position: sane.position,
  };
}

function wardenNotificationSoundAllowed(settings, definition, rule) {
  if (!settings || settings.soundEnabled !== true) return false;
  if (settings.soundMode === 'none') return false;
  var sound = String(rule && rule.sound || '');
  if (!sound || sound === 'none') return false;
  var severity = String(definition && definition.severity || 'info');
  if (settings.soundMode === 'critical') return severity === 'critical';
  if (settings.soundMode === 'important') return severity === 'warning' || severity === 'critical';
  return true;
}

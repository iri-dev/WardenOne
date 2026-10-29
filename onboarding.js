/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Shared Settings descriptions keep the switch guide aligned with the shipped UI. */
function onboardingFeatureGroups(data) {
  const destinations = {
    'Script Shield': ['Script Shield', 'security'],
    'Redirects & popups': ['Pop-ups, redirects and page clutter', 'popups'],
    'IP protection': ['IP protection, HTTPS and certificates', 'network'],
    'Download Shield': ['Download Shield and optional reputation checks', 'downloads'],
    Privacy: ['Tracking, cookies and fingerprinting', 'privacy'],
    AdShield: ['AdShield and search cleanup', 'ads'],
    'Memory Shield': ['Memory Shield and Resource Saver', 'speed'],
    'Forget Me & Logins': ['Forget Me and logins', 'cleanup'],
    'Media Shield': ['Camera, microphone, location and media', 'media'],
    'Adult-site safety': ['Adult-site safety and SafeSearch', 'security'],
    'Advanced detection (catches rotating/custom domains)': ['Site, script and network threat detection', 'security'],
    'SessionShield — login & session protection': ['Sessions, forms, clipboard and scams', 'signin'],
    'Blocklist (auto-updating)': ['Threat blocklists and cryptomining', 'lists'],
    Interface: ['Page notices, badges and Element Zapper', 'look'],
    'Privacy cleaner': ['Extension and permission monitoring', 'security'],
  };
  const seen = new Set();
  const defaults = Object.assign({}, data.defaults, ...data.carried.map((extra) => extra.defaults || {}));
  const manual = new Set(['elementZapper', ...data.carried.flatMap((extra) => extra.rows.map((row) => row.key))]);
  const descriptions = {
    memoryNeverPinned: 'Leave pinned tabs awake when Memory Shield chooses inactive tabs to sleep.',
    memoryNeverAudio: 'Keep tabs playing audio awake, including music or radio in the background.',
    memoryNeverForms: 'Keep tabs with unsaved form input awake so sleeping a tab does not discard your work.',
    memoryNeverPayment: 'Keep recognised login and payment pages awake while you use them.',
  };
  const groups = data.sections.concat(data.carried).map((section, index) => {
    const [title, page] = destinations[section.title] || (section.title ? [section.title, 'overview'] : ['Player tools', 'ads']);
    const items = section.rows.filter((row) => !seen.has(row.key) && seen.add(row.key)).map((row) => ({
      id: row.key, keys: [row.key], name: row.name, desc: row.desc || descriptions[row.key],
      tag: manual.has(row.key) ? 'On demand' + (typeof defaults[row.key] === 'boolean' ? '; default: ' + (defaults[row.key] ? 'on' : 'off') : '') : typeof defaults[row.key] === 'boolean'
        ? 'Default: ' + (defaults[row.key] ? 'on' : 'off') : 'Choose a mode',
      links: [['Find in Settings', 'settings.html#page=' + page + '&inspect=' + encodeURIComponent(row.key)]],
    }));
    return { id: 'controls-' + index, title, intro: 'Each item links to its controls and explanation in Settings.', items };
  });
  const tool = (id, name, desc, links, keys = [], tag = 'On demand') => ({ id, name, desc, links, keys, tag });
  groups.push({ id: 'watch-only', title: 'Watch-only activity', intro: 'These record activity; a record is not proof that a request was blocked.', items: [
    tool('logThirdPartyBeacons', 'Background reports', 'Records background beacon attempts and the destination seen by WardenOne. Review them in Activity.', [['Activity Centre', 'history.html']], ['logThirdPartyBeacons'], 'Watch only'),
    tool('deviceAccessGuard', 'Hardware and file access', 'Records browser requests for hardware or files that WardenOne can observe. Browser permission prompts still make the access decision.', [['Activity Centre', 'history.html']], ['deviceAccessGuard'], 'Watch only'),
    tool('capabilityGuard', 'Browser capabilities', 'Records observed clipboard, fullscreen, keyboard-lock and other powerful browser API use. It does not block these calls by itself.', [['Activity Centre', 'history.html']], ['capabilityGuard'], 'Watch only'),
  ] });
  groups.push({ id: 'page-tools', title: 'Page tools and streaming', intro: 'Actions you start yourself, plus player-specific controls.', items: [
    tool('zapper-workflow', 'Hide an element and bring it back', 'Start Element Zapper from the popup or right-click menu, check the outline, and click. Keep removing items, then press Done or Esc. Ctrl+Z undoes removals on the open page, even after the tool closes. Saved removals stay hidden after reload; Hidden elements restores them individually.', [['Hidden elements', 'hidden-elements.html'], ['Site exceptions', 'settings.html#page=sites']]),
    tool('streaming', 'YouTube, Twitch and Spotify AdShield', 'AdShield has player-specific handling for YouTube and Twitch, and handles Spotify audio ads in the web player. These are compatibility workarounds: sites can change their players, and blocking may be incomplete.', [['Ads and player controls', 'settings.html#page=ads']]),
    tool('right-click', 'Right-click tools', 'The WardenOne menu includes Element Zapper, Copy clean link, Check this link, Check selected text, image and frame inspection, Sleep this tab, Never sleep this site, Close this tab and Block this site. Sleep and close check for unsaved forms and active camera or microphone use.', [['Tools and shortcut guide', 'settings.html#page=shortcuts']]),
    tool('palette', 'Command Palette and keyboard shortcuts', 'Open the palette, type an action and choose it: scan, pause here, clean the address, hide an element, open a tool or change settings. Alt+Shift+O is suggested for the palette and Alt+Shift+U for cleaning the address; the browser may leave a shortcut unassigned. Assign or change keys in your browser.', [['Keyboard shortcuts', 'settings.html#page=shortcuts']]),
  ] });
  groups.push({ id: 'settings-tools', title: 'Settings, layout and site choices', intro: 'Find controls without scrolling through the popup.', items: [
    tool('settings-navigation', 'Settings search, favorites and change history', 'Search names and descriptions, star favorites, review recent changes, compare with Recommended, and inspect enabled choices that may affect compatibility.', [['Settings overview', 'settings.html#page=overview'], ['Favorites', 'settings.html#page=favorites'], ['Recent changes', 'settings.html#page=recent'], ['Changed from Recommended', 'settings.html#page=changed'], ['May affect compatibility', 'settings.html#page=compat']]),
    tool('arrangement', 'Rearrange popup sections', 'Move sections into the order you use them. Search still finds controls, and rearranging does not change any protection switch.', [['Arrange sections', 'settings.html#page=arrange']]),
    tool('appearance', 'Themes, density and site card', 'Choose Light, Dark or System for WardenOne pages. Settings can be Compact or Comfortable. The popup site card offers a one-line summary or separate tracker, ad and other counts; open it for the Site Dashboard.', [['Look and reading', 'settings.html#page=look']], ['theme', 'density', 'siteCard'], 'Appearance'),
    tool('site-dashboard', 'Site Dashboard and per-site control', 'Open the current site card to review its activity, pause protection, or override individual controls for that site. Settings lists pauses, allowlists, blocked and trusted sites, hidden elements, never-sleep sites, WebGL exceptions and firewall rules.', [['Sites and exceptions', 'settings.html#page=sites']]),
    tool('sleep-options', 'Sleep profiles, tab limits and never-sleep sites', 'Choose Gentle, Balanced, Aggressive or Emergency timing; set the maximum tab count and minimum inactive time. Keep selected sites awake. Audio, pinned tabs, unsaved forms and login or payment pages have their own exceptions; active camera/microphone and supported video sites are protected automatically.', [['Speed and memory', 'settings.html#page=speed']], ['memoryMode', 'tabLimitMax', 'tabLimitMinIdleMinutes'], 'Configurable'),
    tool('webgl', 'WebGL controls and site exceptions', 'Leave WebGL Off, disable it on selected sites, or disable it everywhere except allowed sites. Add the current site or manage blocked and allowed hosts. Off by default: games, maps, 3D viewers and some web apps can break without WebGL.', [['Speed and memory', 'settings.html#page=speed'], ['WebGL site lists', 'settings.html#page=sites']], ['webglSaverMode'], 'Default: off'),
    tool('eyeshield-profiles', 'EyeShield adjustments and site profiles', 'Choose Normal, Light, Dark or Ultra, then adjust brightness, contrast, saturation, warmth and grayscale. Apply changes globally or save a profile for one site; sites can inherit the global choices or turn EyeShield off. EyeShield starts off.', [['Look and reading', 'settings.html#page=look']], ['eyeshield', 'eyeShieldBrightness', 'eyeShieldContrast', 'eyeShieldSaturation', 'eyeShieldWarmth', 'eyeShieldGrayscale'], 'Default: off'),
  ] });
  groups.push({ id: 'activity-tools', title: 'Activity, diagnostics and network tools', intro: 'See the evidence behind a warning or a block.', items: [
    tool('activity', 'Activity Centre', 'Review blocked, warned-about and observed events, their reasons, and the site involved. Choose normal retention, browser-session history, or no saved Activity and notifications in Settings. Clear observations keeps your approved blocks and firewall choices.', [['Activity Centre', 'history.html'], ['History choices', 'settings.html#page=cleanup']], ['historyMode'], 'Configurable'),
    tool('notifications', 'Notification Centre and display choices', 'Review notices, group repeats, snooze or mute types, choose where cards appear and how long they stay, set history retention and optionally show an unread toolbar count. Silent Mode hides non-critical notices while protection continues.', [['Notification Centre', 'notifications.html'], ['Notice settings', 'settings.html#page=look']], ['noticeDuration', 'noticePosition', 'noticeGroup', 'noticeBadge', 'noticeRetention'], 'Configurable'),
    tool('notification-sounds', 'Notification sounds', 'Sounds are off by default. Choose which severities make a sound, set the volume, and customise individual notice types in Notification Centre.', [['Notification Centre', 'notifications.html']], ['noticeSound', 'noticeSoundMode', 'noticeVolume'], 'Default: off'),
    tool('health', 'Protection Health and diagnostics', 'The popup separates switches enabled in storage from evidence that guards reached the current page. Inspect list status, permission problems and diagnostics; preview a diagnostic export before sharing it.', [['Help and troubleshooting', 'settings.html#page=help']]),
    tool('repair', 'Verify and Repair', 'Run Verify from the popup to check installation and guard state. Repair reconciles WardenOne with saved choices and refreshes guards where possible. Reload pages when requested; a successful repair is not proof that every site threat will be stopped.', [['Help and troubleshooting', 'settings.html#page=help']]),
    tool('privacy-self-test', 'Privacy Self-Test', 'Run controlled checks for exposed browser surfaces and compare protected measurements with clean ones. It tests the current browser environment and reports limits; it does not certify anonymity.', [['Run the Self-Test', 'privacy-test.html']]),
    tool('network-logger', 'Network Logger', 'Open the logger for the active tab to inspect requests, their types and blocking decisions. Filter the view, inspect an entry and use the evidence to refine your own rules.', [['Network Logger', 'logger.html']]),
    tool('site-firewall', 'Site Firewall', 'Manage per-site resource rules by destination and request type. Advanced rules can break pages, so keep changes narrow and remove a rule if it blocks something you need.', [['Site Firewall', 'firewall.html']]),
    tool('custom-rules', 'My Rules and Custom Lists', 'Add your own network or cosmetic rules, subscribe to custom filter lists, and review list freshness and source failures. A failed refresh does not automatically remove a previously downloaded list.', [['Blocklists and filters', 'settings.html#page=lists']]),
  ] });
  groups.push({ id: 'file-extension-tools', title: 'Files, extensions, providers and updates', intro: 'Local checks and optional outside lookups have different boundaries.', items: [
    tool('file-shield', 'File Shield', 'Choose or drop local files or a folder to inspect formats, executable structures, scripts, shortcuts, archives, documents and SHA-256 hashes. Files are not opened, executed or uploaded. An optional VirusTotal button sends only a hash. Findings do not prove a file is safe; keep your antivirus.', [['Open File Shield', 'file-shield.html']]),
    tool('download-review', 'Download Review', 'Known-dangerous browser downloads are blocked; suspicious ones can be held for an A–F review explaining the source, name, type and reputation evidence. Download Shield cannot freely read the saved file; use File Shield for its actual bytes.', [['Download settings', 'settings.html#page=downloads']]),
    tool('extension-security', 'Extension Security Centre and pre-install checks', 'Review installed extensions, permissions and reputation clues, inspect changes and startup findings, or check an extension ID or Store link before installation. WardenOne reports evidence and cannot guarantee that an extension is harmless.', [['Extension Security Centre', 'extensions.html']]),
    tool('permission-scanner', 'Site Permission Scanner', 'Use the popup scan to review remembered camera, microphone, location and other site permissions. Browser settings remain the place to revoke permissions you no longer want.', [['Permissions guide', 'permissions.html'], ['Permissions and keys', 'settings.html#page=access']]),
    tool('providers', 'Seven optional reputation providers', 'Google Safe Browsing, VirusTotal, URLhaus, AbuseIPDB, OpenPhish, PhishTank and WhoisXML add different checks. Most need your key; OpenPhish downloads a public feed for local matching. WhoisXML has three independently enabled checks. Automatic providers start only when enabled and may receive addresses or domains; review their data disclosures.', [['Providers, keys and disclosures', 'api-keys.html'], ['Permissions and keys', 'settings.html#page=access']], [], 'Opt-in'),
    tool('url-scanner', 'Manual VirusTotal URL scanner', 'Paste a URL in the popup and start its lookup using your own key. This can work while automatic VirusTotal checks are off. The pasted URL, including its query string, is sent to VirusTotal; remove secrets or private tokens before scanning.', [['Provider guide', 'api-keys.html']]),
    tool('updates', 'Browser Update Guardian and WardenOne build notices', 'The popup can warn about an outdated browser. Official GitHub ZIP builds can compare their packaged commit with the latest complete build; Settings About explains the result, Check again and manual update steps. The notice does not install an update for you.', [['About and build status', 'settings.html#page=about']]),
  ] });
  groups.push({ id: 'data-tools', title: 'Privacy cleanup, backup and help', intro: 'Your own data and configuration stay under your control.', items: [
    tool('privacy-cleaner', 'Privacy Cleaner and WardenOne data erasure', 'Choose which browser data to clear and the time range. Review consent cookies separately from clearing every sign-in. You can also erase WardenOne activity, notices, caches or other saved data from Settings.', [['Clean-up and backup', 'settings.html#page=cleanup']]),
    tool('backup', 'Settings backup and import', 'Export your settings and lists, preview an import and restore supported choices. API keys are excluded from backups. You can also reset selected settings or return to defaults.', [['Clean-up and backup', 'settings.html#page=cleanup']]),
    tool('session-tools', 'Session Security Grade and Emergency Logout', 'The popup grades observed session risks and offers Emergency Logout to clear the relevant session data when you choose it. A good grade does not guarantee a site or account is safe.', [['Sign-in and sessions', 'settings.html#page=signin']]),
    tool('network-guide', 'Network and DNS guide', 'Read how DNS and device-level tools can extend protection beyond this browser. WardenOne itself does not install a VPN or protect every app on your network.', [['Network and DNS guide', 'network.html']]),
    tool('help', 'Help, privacy, source and credits', 'Report a problem or idea, read the privacy and permissions explanations, inspect the open-source project, and see credits and licences. No WardenOne account is needed and WardenOne sends no telemetry.', [['Help and feedback', 'settings.html#page=help'], ['About, privacy and credits', 'settings.html#page=about'], ['Permissions guide', 'permissions.html']]),
  ] });
  return groups.filter((group) => group.items.length);
}

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---- stepper state -------------------------------------------------------
  const STEPS = ['welcome', 'pin', 'protect', 'explore'];
  const scenes = {};
  document.querySelectorAll('.scene').forEach((el) => { scenes[el.dataset.scene] = el; });

  const dots = Array.from(document.querySelectorAll('.dot'));
  const backBtn = $('back');
  const nextBtn = $('next');
  const footNote = $('foot-note');
  const status = $('status');
  const coverFrame = document.querySelector('.cover-frame');
  const coverWrap = document.querySelector('.cover-wrap');
  let index = 0;
  let phase = 'wizard'; // 'wizard' | 'done' | 'closed'

  // show the top/bottom fades only when there's more to scroll in that direction
  function updateCoverFades() {
    if (!coverFrame || !coverWrap) return;
    const moreAbove = coverWrap.scrollTop > 2;
    const moreBelow = coverWrap.scrollTop + coverWrap.clientHeight < coverWrap.scrollHeight - 2;
    coverFrame.classList.toggle('has-top', moreAbove);
    coverFrame.classList.toggle('has-bottom', moreBelow);
  }

  const FOOT = {
    welcome: 'Takes about a minute. You can change anything later.',
    pin: 'Pinning is optional, but it keeps WardenOne one click away.',
    protect: 'Recommended is the safe default. Tweak any switch later from the popup.',
    explore: 'Explore the guide whenever you like, or finish setup now.',
    done: 'One last step — then you\'re free to go.',
    closed: 'Setup complete. It\'s safe to close this tab.',
  };

  function showScene(name) {
    Object.keys(scenes).forEach((key) => {
      const on = key === name;
      scenes[key].hidden = !on;
      scenes[key].classList.toggle('enter', on);
    });
    const scene = scenes[name];
    if (scene) { try { scene.focus({ preventScroll: true }); } catch (_) { try { scene.focus(); } catch (__) {} } }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Set the footer buttons in one place so they can never be left half-updated.
  function setFooter(opts) {
    backBtn.hidden = !opts.back;
    if (!opts.next) {
      nextBtn.hidden = true;
      return;
    }
    nextBtn.hidden = false;
    nextBtn.disabled = false;
    nextBtn.textContent = '';
    nextBtn.appendChild(document.createTextNode(opts.next.label || ''));
    if (opts.next.arrow) {
      const arrow = document.createElement('span');
      arrow.className = 'ar';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '\u2192';
      nextBtn.appendChild(arrow);
    }
    nextBtn.classList.toggle('done', !!opts.next.done);
  }

  function render() {
    phase = 'wizard';
    const name = STEPS[index];
    if (name === 'pin') refreshPinState();
    document.body.dataset.step = name;
    showScene(name);

    dots.forEach((d, i) => {
      d.classList.toggle('active', i === index);
      d.classList.toggle('done', i < index);
      d.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });

    const last = index === STEPS.length - 1;
    setFooter({
      back: index > 0,
      next: { label: last ? 'Finish setup' : 'Next', arrow: !last, done: last },
    });
    if (footNote) footNote.textContent = FOOT[name] || '';
    updateCoverFades();
  }

  function showDone() {
    phase = 'done';
    document.body.dataset.step = 'done';
    showScene('done');
    dots.forEach((d) => { d.classList.add('done'); d.classList.remove('active'); });
    setFooter({ back: true, next: { label: 'Finish', arrow: true, done: true } });
    if (footNote) footNote.textContent = FOOT.done;
  }

  function showClosed() {
    phase = 'closed';
    document.body.dataset.step = 'closed';
    showScene('closed');
    setFooter({ back: true, next: null });
    if (footNote) footNote.textContent = FOOT.closed;
  }

  function goTo(i) {
    index = Math.max(0, Math.min(STEPS.length - 1, i));
    render();
  }

  async function next() {
    if (phase === 'done') { showClosed(); return; }
    if (phase === 'closed') { closeTab(); return; }
    if (index < STEPS.length - 1) { goTo(index + 1); return; }
    await finishSetup();
  }

  function back() {
    if (phase === 'closed') { showDone(); return; }
    if (phase === 'done') { goTo(STEPS.length - 1); return; }
    goTo(index - 1);
  }

  // ---- chrome plumbing -----------------------------------------------------
  function hasChromeApi() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  }

  function setStatus(text, tone) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'status' + (tone ? ' ' + tone : '');
  }

  function setButtonBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (text) btn.textContent = text;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      if (!hasChromeApi() || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: 'Chrome extension APIs are not available on this page.' });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message || String(err) });
          else resolve(res || { ok: false, error: 'No response from WardenOne.' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!hasChromeApi() || !chrome.storage || !chrome.storage.local) { resolve({}); return; }
      try { chrome.storage.local.get(key, (res) => resolve(res || {})); } catch (_) { resolve({}); }
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      if (!hasChromeApi() || !chrome.storage || !chrome.storage.local) { resolve(false); return; }
      try { chrome.storage.local.set(value, () => resolve(!chrome.runtime.lastError)); } catch (_) { resolve(false); }
    });
  }

  const pinTitle = $('pin-title');
  const pinLead = $('pin-lead');
  const pinState = $('pin-state');
  const pinSteps = $('pin-steps');
  function paintPinState(pinned) {
    const on = pinned === true;
    pinTitle.textContent = on ? 'WardenOne is already pinned.' : 'Pin WardenOne to your toolbar.';
    pinLead.textContent = on
      ? 'Its shield icon is in your browser toolbar, ready whenever you want to open the controls.'
      : 'Open the extensions menu at the top-right of your browser, find WardenOne in the list, and click the pin. It stays one click away from then on.';
    pinState.hidden = !on;
    pinSteps.hidden = on;
  }

  async function refreshPinState() {
    if (!hasChromeApi() || !chrome.action || typeof chrome.action.getUserSettings !== 'function') return;
    try {
      const settings = await chrome.action.getUserSettings();
      paintPinState(settings && settings.isOnToolbar === true);
    } catch (_) {}
  }

  const SITE_CARD_LAYOUT_KEY = 'wardenone_site_card_layout';
  const siteCardButtons = Array.from(document.querySelectorAll('[data-site-card-layout]'));
  let siteCardChoiceTouched = false;
  function paintSiteCardLayout(value) {
    const layout = value === 'B' ? 'B' : 'A';
    siteCardButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.siteCardLayout === layout)));
  }

  // ---- apply recommended ---------------------------------------------------
  const applyBtn = $('apply');

  function markApplyDone() {
    if (!applyBtn) return;
    applyBtn.disabled = false;
    applyBtn.textContent = 'Recommended protection is on';
    applyBtn.classList.remove('primary');
    applyBtn.classList.add('done');
  }

  async function applyRecommended() {
    setButtonBusy(applyBtn, true, 'Turning it on...');
    setStatus('');
    const res = await sendMessage({ kind: 'apply-onboarding-recommended' });
    if (!res || res.ok === false) {
      setButtonBusy(applyBtn, false, 'Turn on recommended protection');
      setStatus((res && res.error) || 'Could not apply the recommended settings.', 'bad');
      return;
    }
    await storageSet({ wardenone_onboarding_recommended_at: Date.now() });
    markApplyDone();
    setStatus('Recommended protection applied. Existing advanced choices are preserved; review them in Settings.', 'good');
  }

  // ---- apply maximum privacy (opt-in, superset of recommended) -------------
  const applyMaxBtn = $('apply-max');

  function markMaxApplyDone() {
    if (applyMaxBtn) {
      applyMaxBtn.disabled = false;
      applyMaxBtn.textContent = 'Maximum privacy is on';
      applyMaxBtn.classList.add('done');
    }
    // Maximum privacy includes everything Recommended does, so reflect that too.
    markApplyDone();
  }

  async function applyMaxPrivacy() {
    setButtonBusy(applyMaxBtn, true, 'Turning it on...');
    setStatus('');
    const res = await sendMessage({ kind: 'apply-onboarding-max-privacy' });
    if (!res || res.ok === false) {
      setButtonBusy(applyMaxBtn, false, 'Maximum privacy');
      setStatus((res && res.error) || 'Could not apply the maximum-privacy settings.', 'bad');
      return;
    }
    await storageSet({ wardenone_onboarding_recommended_at: Date.now(), wardenone_onboarding_maxprivacy_at: Date.now() });
    markMaxApplyDone();
    setStatus('Maximum privacy is on. If a site ever looks off, allowlist it from the popup — every part of this is reversible there.', 'good');
  }

  // ---- open controls -------------------------------------------------------
  // Open the real popup as the anchored toolbar dropdown. A short debounce keeps
  // a double-press from triggering two opens.
  let lastOpenAt = 0;

  function guideToToolbar() {
    setStatus('Click the WardenOne shield in your toolbar. If it is hidden, open the Extensions puzzle menu and select WardenOne.', 'good');
  }

  function openControls() {
    if (!hasChromeApi()) {
      setStatus('Open this page from the installed extension to use the buttons.', 'bad');
      return;
    }
    const now = Date.now();
    if (now - lastOpenAt < 600) return; // never trigger two opens from one double-press
    lastOpenAt = now;

    if (!chrome.action || !chrome.action.openPopup) { guideToToolbar(); return; }

    let result;
    try {
      result = chrome.action.openPopup(); // MV3: returns a Promise
    } catch (_) {
      guideToToolbar();
      return;
    }

    if (result && typeof result.then === 'function') {
      result.then(() => setStatus('Controls opened in the toolbar.', 'good')).catch(() => guideToToolbar());
    } else if (chrome.runtime.lastError) {
      guideToToolbar();
    } else {
      setStatus('Controls opened in the toolbar.', 'good');
    }
  }

  // ---- close this tab ------------------------------------------------------
  function manualCloseHint() {
    setStatus('Your settings are saved. You can close this tab manually.', 'good');
  }

  function closeTab() {
    if (hasChromeApi() && chrome.tabs && chrome.tabs.getCurrent) {
      try {
        chrome.tabs.getCurrent((tab) => {
          if (chrome.runtime.lastError || !tab || tab.id == null || !chrome.tabs.remove) {
            manualCloseHint();
            return;
          }
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) {
              try { window.close(); } catch (_) {}
              manualCloseHint();
            }
          });
        });
        return;
      } catch (_) {}
    }
    try { window.close(); } catch (_) {}
    manualCloseHint();
  }

  // ---- notification mode ---------------------------------------------------
  const normalMode = $('normal-mode');
  const silentMode = $('silent-mode');
  const modeNote = $('mode-note');

  function paintMode(isSilent) {
    if (silentMode) { silentMode.classList.toggle('active', !!isSilent); silentMode.setAttribute('aria-checked', isSilent ? 'true' : 'false'); }
    if (normalMode) { normalMode.classList.toggle('active', !isSilent); normalMode.setAttribute('aria-checked', !isSilent ? 'true' : 'false'); }
    if (modeNote) {
      modeNote.textContent = isSilent
        ? 'Silent Mode is on. Protection keeps running; non-critical popups, badges, and notifications stay hidden.'
        : 'Your saved keys, allowlists, trusted download sites and other choices are preserved. Review or change them in Settings whenever you need to.';
    }
  }

  /* Under the config lock (config-lock.js), so a change saved elsewhere at the same moment is kept;
     if a private window wrote over it without seeing it, it is saved again (confirmConfigWrite). */
  async function writeSilentMode(isSilent, triesLeft, operationOrder) {
    let writeId = '';
    let writeOrder = operationOrder;
    const ok = await withConfigLock(async () => {
      const store = await storageGet(['wardenone_config', WO_CONFIG_WRITES_KEY]);
      const current = (store && store.wardenone_config && typeof store.wardenone_config === 'object') ? store.wardenone_config : {};
      const next = Object.assign({}, current, { silentMode: isSilent, showDownloadBar: true });
      const changedKeys = ['silentMode', 'showDownloadBar'];
      const stamp = stampConfigWrite(store && store[WO_CONFIG_WRITES_KEY], changedKeys, writeOrder);
      const written = await storageSet({ wardenone_config: next, [WO_CONFIG_WRITES_KEY]: stamp.record });
      if (written) { writeId = stamp.id; writeOrder = stamp.order; }
      return written;
    });
    confirmConfigWrite(writeId, (left) => { writeSilentMode(isSilent, left, writeOrder); }, triesLeft,
      ['silentMode', 'showDownloadBar'], writeOrder);
    return ok;
  }

  async function setSilentMode(isSilent) {
    setStatus('');
    const ok = await writeSilentMode(!!isSilent);
    if (!ok) { setStatus('Could not save your notification choice.', 'bad'); return; }
    paintMode(!!isSilent);
    setStatus(isSilent ? 'Silent Mode saved.' : 'Normal notifications saved.', 'good');
  }

  // ---- finish --------------------------------------------------------------
  async function finishSetup() {
    if (phase !== 'wizard') { showClosed(); return; }
    setButtonBusy(nextBtn, true, 'Saving...');
    const ok = await storageSet({ wardenone_onboarding_done_at: Date.now() });
    if (!ok) {
      setButtonBusy(nextBtn, false);
      nextBtn.textContent = 'Finish setup';
      setStatus('Could not save your setup state, but protection is still active.', 'bad');
      return;
    }
    setStatus('Setup complete.', 'good');
    showDone();
  }

  function renderFeatureGuide() {
    const host = $('feature-groups');
    if (!host || typeof SETTINGS_DATA !== 'object') return;
    const data = SETTINGS_DATA;
    const total = data.shieldKeys.length + data.watchOnlyKeys.length;
    for (const [id, value] of [['onboarding-total', total], ['onboarding-total-stat', total],
      ['onboarding-switchable', data.shieldKeys.length], ['onboarding-watch-only', data.watchOnlyKeys.length]]) {
      if ($(id)) $(id).textContent = String(value);
    }
    const entries = [];
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text) element.textContent = text;
      return element;
    };
    for (const group of onboardingFeatureGroups(data)) {
      const details = node('details', 'guide-group');
      details.dataset.guideGroup = group.id;
      const summary = node('summary', '', group.title);
      summary.appendChild(node('small', '', group.intro));
      details.appendChild(summary);
      const list = node('ul', 'guide-list');
      const rows = [];
      for (const item of group.items) {
        const row = node('li', 'guide-item');
        row.dataset.guideFeature = item.id;
        const title = node('div', 'guide-item-title', item.name);
        if (item.tag) title.appendChild(node('span', 'guide-tag', item.tag));
        row.appendChild(title);
        row.appendChild(node('p', '', item.desc));
        const links = node('div', 'guide-links');
        for (const [label, href] of item.links) {
          const link = node('a', '', label);
          link.setAttribute('href', href);
          links.appendChild(link);
        }
        row.appendChild(links);
        list.appendChild(row);
        rows.push({ row, text: (group.title + ' ' + item.name + ' ' + item.desc).toLowerCase() });
      }
      details.appendChild(list);
      host.appendChild(details);
      entries.push({ details, rows, wasOpen: false });
    }
    let searching = false;
    function filterGuide() {
      const terms = $('feature-search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (terms.length && !searching) entries.forEach((entry) => { entry.wasOpen = entry.details.open; });
      let matches = 0;
      for (const entry of entries) {
        let visible = 0;
        for (const { row, text } of entry.rows) {
          row.hidden = !terms.every((term) => text.includes(term));
          if (!row.hidden) visible++;
        }
        entry.details.hidden = visible === 0;
        if (terms.length) entry.details.open = visible > 0;
        else if (searching) entry.details.open = entry.wasOpen;
        matches += visible;
      }
      searching = terms.length > 0;
      $('feature-results').textContent = searching
        ? matches + (matches === 1 ? ' matching feature or control.' : ' matching features and controls.') + (matches ? '' : ' Try a broader word, such as privacy or tabs.')
        : 'Open a group, or search by a feature name or what it does.';
    }
    $('feature-search').addEventListener('input', filterGuide);
    filterGuide();
  }

  // ---- wiring --------------------------------------------------------------
  function init() {
    renderFeatureGuide();
    $('explore-features')?.addEventListener('click', () => {
      goTo(3);
      $('feature-catalog').open = true;
      $('feature-guide').scrollIntoView({ block: 'start' });
    });
    $('start')?.addEventListener('click', () => goTo(1));
    backBtn?.addEventListener('click', back);
    nextBtn?.addEventListener('click', next);
    $('skip')?.addEventListener('click', () => {
      if (phase === 'closed') { closeTab(); return; }
      if (phase === 'done') { showClosed(); return; }
      finishSetup();
    });

    dots.forEach((d) => d.addEventListener('click', () => goTo(parseInt(d.dataset.go, 10) || 0)));

    [$('open-popup-welcome'), $('open-popup-pin'), $('open-popup-explore'), $('open-popup-done'), $('open-popup-closed')]
      .filter(Boolean)
      .forEach((btn) => btn.addEventListener('click', openControls));

    $('close-tab')?.addEventListener('click', closeTab);

    if (coverWrap) {
      coverWrap.addEventListener('scroll', updateCoverFades, { passive: true });
      window.addEventListener('resize', updateCoverFades);
    }

    applyBtn?.addEventListener('click', applyRecommended);
    applyMaxBtn?.addEventListener('click', applyMaxPrivacy);
    normalMode?.addEventListener('click', () => setSilentMode(false));
    silentMode?.addEventListener('click', () => setSilentMode(true));
    siteCardButtons.forEach((button) => button.addEventListener('click', async () => {
      const layout = button.dataset.siteCardLayout;
      siteCardChoiceTouched = true;
      paintSiteCardLayout(layout);
      if (!(await storageSet({ [SITE_CARD_LAYOUT_KEY]: layout }))) {
        setStatus('Could not save the site card choice. Try again from the popup settings.', 'bad');
      }
    }));
    try {
      chrome.action.onUserSettingsChanged?.addListener(refreshPinState);
    } catch (_) {}
    window.addEventListener('focus', () => {
      if (phase === 'wizard' && STEPS[index] === 'pin') refreshPinState();
    });

    // keyboard: left/right arrows move through the flow
    document.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.target?.closest('#feature-guide')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    });

    // restore prior state
    storageGet(['wardenone_config', 'wardenone_onboarding_recommended_at', 'wardenone_onboarding_maxprivacy_at', 'wardenone_onboarding_done_at', SITE_CARD_LAYOUT_KEY])
      .then((store) => {
        const cfg = (store && store.wardenone_config) || {};
        if (!siteCardChoiceTouched) paintSiteCardLayout(store && store[SITE_CARD_LAYOUT_KEY]);
        paintMode(cfg.silentMode === true);
        if (store && store.wardenone_onboarding_maxprivacy_at) markMaxApplyDone();
        else if (store && store.wardenone_onboarding_recommended_at) markApplyDone();
      });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[SITE_CARD_LAYOUT_KEY]) paintSiteCardLayout(changes[SITE_CARD_LAYOUT_KEY].newValue);
      });
    } catch (_) {}

    render();
  }

  init();
}());

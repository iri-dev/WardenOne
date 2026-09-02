'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

async function main() {
  const manifest = JSON.parse(read('manifest.json'));
  assert(manifest.permissions.includes('offscreen'), 'manifest must grant offscreen audio permission');

  const background = read('background.js');
  assert(background.includes("importScripts('notification-manager.js')"), 'background must load the notification manager');
  assert(background.includes('recordWardenNotification(safe)'), 'sanitised history must feed the Notification Centre');
  assert(background.includes("msg.kind === 'notification-sound-preview'"), 'extension pages need a bounded sound preview route');

  /* The page was rewritten, so these check that the CONTROLS exist rather than
     that particular sentences do. The old versions pinned copy -- 'Sound is
     always off by default' and so on -- which meant rewording the page failed
     the suite while removing the control it described did not. */
  const page = read('notifications.html');
  const pageJs = read('notifications.js');
  const guideCss = read('guide-shell.css');
  assert(page.includes('Notification Centre'), 'Notification Centre page is missing');
  [
    ['pref-retention', 'history retention'],
    ['pref-group', 'grouping'],
    ['pref-soundmode', 'sound mode'],
    ['pref-sound', 'the sound switch'],
    ['pref-volume', 'volume'],
    ['pref-preview', 'sound preview'],
    ['pref-duration', 'default duration'],
    ['pref-position', 'toast position'],
    ['pref-badge', 'the badge switch'],
    ['tab-prefs', 'the Preferences tab'],
    ['tab-recent', 'the Recent tab'],
    ['nc-read', 'mark all read'],
    ['nc-clear', 'clear history'],
  ].forEach(([id, what]) => {
    assert(page.includes('id="' + id + '"'), what + ' control is missing (#' + id + ')');
  });

  /* Sound stays opt-in. The schema is the one place that decides, and the page
     must not quietly ship an on-by-default switch of its own. */
  assert(read('notification-schema.js').includes('soundEnabled: false'),
    'sound must be off until the reader turns it on');
  assert(/off until you turn it on|silent by default/i.test(page),
    'the page should say plainly that it is silent by default');

  /* Every mode the reader can pick has to be one the worker honours. */
  ['off', 'history', 'toast', 'persistent'].forEach((mode) => {
    assert(pageJs.includes("'" + mode + "'"), 'the page does not offer the ' + mode + ' mode');
  });

  /* Grouping was carried in the settings from the start and never implemented,
     which on a tracker-heavy site buries the one notice that mattered under
     forty identical lines. */
  assert(/function groupItems\(/.test(pageJs) && /groupItems\(visible/.test(pageJs), 'grouping is configurable but not implemented');
  assert(/GROUP_WINDOW_MS/.test(pageJs), 'grouping must be bounded in time, not "same kind ever"');

  assert(!/\son[a-z]+\s*=/.test(page), 'Notification Centre must not use inline event handlers');
  assert(page.includes('notifications.js') && page.includes('theme.js') && page.includes('notification-schema.js'), 'Notification Centre scripts are incomplete');
  /* Theming is theme.js plus theme.css, exactly as on every other page. The
     first rewrite of this page keyed its own dark palette off
     prefers-color-scheme, which no other WardenOne page does -- so this one
     page went dark while the rest of the extension stayed light. */
  assert(page.includes('theme.js'), 'the page must take its theme the way the others do');
  assert(!/prefers-color-scheme/.test(page),
    'no other WardenOne page follows the OS theme; this one must not either');
  /* Notification and Activity are working pages, but their chrome belongs to
     the same guide family as DNS, Permissions, and API keys -- not to a copied
     version of the old Activity dashboard. */
  ['guide-topbar', 'guide-brand', 'guide-hero', 'guide-section', 'guide-summary', 'guide-footer']
    .forEach((token) => {
      assert(page.includes(token), 'the page does not use the guide page chrome (' + token + ')');
    });
  assert(page.includes('href="guide-shell.css"')
    && page.indexOf('theme.css') < page.indexOf('guide-shell.css'),
  'the shared guide shell must load after the theme tokens');
  assert(page.indexOf('theme.js') < page.indexOf('</head>'),
    'the notification theme must resolve before the page body is painted');
  assert(/\.guide-hero\s*\{[\s\S]*?linear-gradient\(135deg,[^}]+\}/.test(guideCss)
    && /\.guide-hero h1[^}]+color:\s*#fff/.test(guideCss),
  'the shared guide hero must use the purple guide treatment, not a white paper surface');
  assert(!page.includes('id="nc-badge"'),
    'the unread count must not be squeezed onto the hero headline');
  assert(/\.row:nth-child\(even\)[^}]+background:\s*color-mix/.test(guideCss),
    'preference rows need visible lilac separation instead of one white slab');
  assert(/data-notification-view/.test(page) && /location\.hash === '#preferences'/.test(pageJs),
    'the guide navigation does not open the matching notification view');
  const activityPage = read('history.html');
  ['guide-topbar', 'guide-brand', 'guide-hero', 'guide-section', 'guide-summary',
    'activity-grid', 'guide-footer'].forEach((token) => {
    assert(activityPage.includes(token), 'Activity does not use the guide page chrome (' + token + ')');
  });
  assert(activityPage.includes('href="guide-shell.css"')
    && activityPage.indexOf('theme.css') < activityPage.indexOf('guide-shell.css'),
  'Activity must load the shared guide shell after the theme tokens');
  assert(background.includes("'guide-shell.css'"), 'Repair does not include the shared guide stylesheet');

  /* A duration is not a number you can judge -- it is a length of time you have
     to sit through. tools/toast-harness.html exists for exactly that reason, as
     a developer page; there is no reason the person choosing the setting should
     not get the same thing. */
  assert(page.includes('id="pref-try"'), 'there is no way to see how long the chosen duration actually is');
  assert(page.includes('<option value="reading">'), 'the pre-centre reading-time default is missing from the duration choices');
  assert(/function previewToast/.test(pageJs), 'the preview control is not wired to anything');
  assert(/tryprog|trycount/.test(pageJs) && /\.tryprog|\.trycount/.test(guideCss),
    'the preview should show the time draining, not just appear and vanish');
  /* It has to appear where the reader said toasts appear, or it is previewing
     something other than the setting. */
  /* Matched on a CALL, not the declaration -- 'function previewToast(value,
     position)' satisfied the loose version whether or not anything passed one. */
  assert(/previewToast\(NC\.settings\.defaultDuration,\s*NC\.settings\.position\)/.test(pageJs),
    'the preview ignores the chosen corner');
  /* "Until dismissed" with a countdown on it would be a lie. */
  assert(/value === 'persistent'[\s\S]{0,80}return 0/.test(pageJs),
    'a persistent card must preview without a timer');

  /* Every category can override the default length, so every category needs its
     own way to see that length. Without one, the single number on the row you
     actually changed is the one you cannot preview. */
  /* Anchored on the declaration AND the use. A bare /timeIt/ matched a renamed
     `timeItX` and passed while the button was gone from the row. */
  assert(/const timeIt = el\(/.test(pageJs)
    && /const durCell = cell\('Time on screen', dur, timeIt\)/.test(pageJs)
    && /row\.appendChild\(durCell\)/.test(pageJs),
    'a category cannot preview its own duration');
  /* Every other WardenOne page draws its icons as inline stroked SVG. This one
     used emoji, which is the single loudest "made at home" signal on the page --
     and emoji render as a different picture on every platform. */
  assert(/document\.createElementNS\(SVG_NS, 'svg'\)/.test(pageJs)
    && /ic\.appendChild\(iconSvg\(def\.icon\)\)/.test(pageJs),
    'notification rows are not drawing real icons');
  assert(!/\p{Extended_Pictographic}/u.test(pageJs),
    'an emoji is back in the notification page script');
  assert(/stroke-width', '1\.9'/.test(pageJs),
    'the icons are not stroked the way the rest of WardenOne draws them');
  assert(/hear\.appendChild\(iconSvg\('play'\)\)/.test(pageJs)
    && /timeIt\.appendChild\(iconSvg\('timer'\)\)/.test(pageJs),
    'the row preview buttons are drawn as characters rather than icons');
  assert(/id="pref-try"><svg/.test(page) && /id="pref-preview"><svg/.test(page),
    'the two preview buttons in the markup are drawn as characters');
  /* Play and timer are interface glyphs, not categories. Kept in their own map
     so "every category has an icon" cannot be satisfied by one of them. */
  assert(/const UI_ICON_PATHS = \{/.test(pageJs)
    && /ICON_PATHS\[name\] \|\| UI_ICON_PATHS\[name\] \|\| ICON_PATHS\.bell/.test(pageJs),
    'interface glyphs are mixed in with the category icons');

  /* The guard that matters: a category added to the schema with an icon name
     nobody drew would silently fall back to a bell, and every row of that
     category would wear the wrong picture. Checked against the real catalogue,
     not a list copied into this test. */
  {
    const schema = read('notification-schema.js');
    const box = {};
    const load = new Function('box', schema + ';box.rules = WARDEN_NOTIFICATION_RULES;');
    load(box);
    const literal = pageJs.match(/const ICON_PATHS = (\{[\s\S]*?\n\});/);
    assert(literal, 'the icon set is gone');
    const paths = new Function('return (' + literal[1] + ');')();
    const wanted = Object.values(box.rules).map((r) => r.icon);
    const missing = wanted.filter((name) => !paths[name]);
    assert(!missing.length, 'no icon drawn for: ' + missing.join(', '));
    const spare = Object.keys(paths).filter((k) => k !== 'bell' && !wanted.includes(k));
    assert(!spare.length, 'icons drawn for categories that do not exist: ' + spare.join(', '));
  }

  /* The section list beside the panels is generated from the same catalogue the
     panels are. Written out by hand it becomes the copy nobody updates. */
  assert(/function renderSettingsNav\(\)/.test(pageJs) && /renderSettingsNav\(\);/.test(pageJs),
    'the settings page has no section navigation');
  assert(/sections\(\)\.forEach\(\(section\) => \{\s*if \(document\.getElementById\('sec-' \+ section\.id\)\)/.test(pageJs),
    'the section list is not built from the rendered panels');
  assert(/card\.id = 'sec-' \+ section\.id;/.test(pageJs),
    'the generated panels have no id for the section list to reach');
  assert(/id="sec-behaviour"/.test(page) && /id="sec-sound"/.test(page),
    'the two static panels cannot be reached from the section list');
  /* toggleAttribute writes aria-current="", which is not a valid token and never
     matches the [aria-current="true"] rule -- the highlight would silently stop
     following the scroll while every test about the nav still passed. */
  assert(!/toggleAttribute\('aria-current'/.test(pageJs),
    'aria-current is being toggled to an empty value the stylesheet cannot match');
  assert(/setAttribute\('aria-current', 'true'\)/.test(pageJs)
    && /removeAttribute\('aria-current'\)/.test(pageJs),
    'the section list does not follow the scroll');
  assert(/\.settings-nav a\[aria-current="true"\]\s*\{/.test(guideCss),
    'the current section is not drawn any differently');
  assert(/\.settings-nav\s*\{[^}]*position:\s*sticky/.test(guideCss),
    'the section list scrolls away with the page instead of staying put');
  assert(/\.settings-shell\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*215px/.test(guideCss),
    'preferences is still one long column');

  /* Four unlabelled controls in a line is four guesses -- the second dropdown
     could be anything. The header and the rows must share one grid, or the
     labels sit near the controls rather than over them. */
  assert(/const colhead = el\('div', 'rulehead'\)/.test(pageJs)
    && /card\.appendChild\(colhead\)/.test(pageJs),
    'per-notice controls have no column headings');
  assert(/'Notice', 'Show as', 'Time on screen', 'Sound'/.test(pageJs),
    'the column headings do not name the four controls');
  assert(/\.rulerow, \.rulehead\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/.test(guideCss),
    'the headings and the rows are not laid out on the same grid');
  assert(/row = el\('div', 'row rulerow'\)/.test(pageJs),
    'the rule rows do not opt into the grid the headings use');
  assert(/const sndCell = cell\('Sound', snd, hear\)/.test(pageJs)
    && /row\.appendChild\(sndCell\)/.test(pageJs),
    'the sound preview sits outside the column it previews');
  /* Wide, the column heading names each control. Stacked, the headings are gone,
     so the control has to name itself or the row is three unlabelled dropdowns
     again -- which is the whole problem the headings were added to fix. */
  assert(/box\.appendChild\(el\('span', 'lbl', label\)\)/.test(pageJs)
    && /row\.appendChild\(cell\('Show as', mode\)\)/.test(pageJs),
    'the stacked controls carry no labels of their own');
  assert(/\.rulerow \.cell \.lbl\s*\{\s*display:\s*none/.test(guideCss)
    && /\.rulerow \.cell \.lbl\s*\{\s*display:\s*block/.test(guideCss),
    'the per-control labels are not swapped in when the columns stack');

  /* The preview is a claim about how the real toast will look, so it has to move
     like one. It was redrawn from a 60ms interval -- neither the frame rate nor a
     multiple of it -- which made the preview visibly stutter while the toast it
     was previewing did not. The bar belongs to the compositor; only the countdown
     text stays on a timer, and that is written from a frame callback. */
  assert(/bar\.style\.transition = 'transform ' \+ ms \+ 'ms linear'/.test(pageJs)
    && /bar\.style\.transform = 'scaleX\(0\)'/.test(pageJs),
    'the preview progress bar is not handed to a CSS transition');
  /* "Try it" is two words on one line. Left to wrap it breaks mid-phrase inside
     a narrow settings column, which reads as a layout fault rather than a button. */
  {
    const shell = read('guide-shell.css');
    assert(/\.act \{[^}]*white-space: nowrap/.test(shell),
      'the inline action buttons are allowed to wrap mid-label');
  }
  assert(/void bar\.offsetWidth;/.test(pageJs),
    'without a forced reflow the two writes collapse and the bar starts empty');
  assert(/tryRaf = left > 0 \? requestAnimationFrame\(paint\) : 0;/.test(pageJs),
    'the countdown is not driven from a frame callback');
  assert(!/setInterval\(paint/.test(pageJs),
    'the preview is back on an interval');
  assert(/if \(tryRaf\) \{ cancelAnimationFrame\(tryRaf\); tryRaf = 0; \}/.test(pageJs),
    'a preview replaced mid-countdown leaves its frame callback running');

  assert(/previewToast\(mode\.value === 'persistent' \? 'persistent' : value/.test(pageJs),
    'a category set to "until dismissed" would preview with a countdown on it');
  assert(/dur\.value === 'default' \? NC\.settings\.defaultDuration : dur\.value/.test(pageJs),
    'a category on "default time" must preview the default, not a guess');
  /* The card carries that category's own title, or every preview looks the same
     and you cannot tell which row you pressed. */
  assert(/function previewToast\(value, position, title\)/.test(pageJs)
    && /el\('div', 'tt', title \|\| /.test(pageJs),
    'the preview does not say which notice it is showing');
  assert(/timeIt\.disabled = off/.test(pageJs),
    'a category that never appears has nothing to time');

  assert(/\.guide-panel, \.panel, \.dashboard-panel\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0/.test(guideCss),
    'guide panels are not sized by their content');
  assert(!/100vh\s*-\s*292px|min-height:\s*520px/.test(guideCss),
    'the shared guide shell inherited the old Activity viewport-height panels');

  const popup = read('popup.html');
  const popupJsSrc = read('popup.js');
  assert(popup.includes('id="open-notifications"'), 'popup must link to the Notification Centre');
  /* The visible count pill is gone on purpose. It duplicated the number the
     toolbar shield already carries, and it sat in a row of plain navigation
     buttons where nothing else has a badge -- so it read as an alert about the
     popup rather than a count of things waiting somewhere else.
     It stays in the accessible name, which is the only place it is now
     available to a reader who cannot see the shield. */
  assert(!popup.includes('id="notification-count"'), 'the duplicate count pill is back in the popup');

  /* The three navigation buttons sit in one row, so they have to be written the
     same way. "Notification Centre" was the only one carrying a capitalised
     second word next to "Activity log" and "Network (DNS)", which is the kind of
     thing that reads as a mistake rather than as emphasis. Read from the row
     itself rather than asserting one spelling, so a fourth button is covered. */
  {
    const row = popup.slice(popup.indexOf('id="open-activity"'),
      popup.indexOf('</div>', popup.indexOf('id="open-network"')));
    const labels = [...row.matchAll(/<\/svg>\s*([^<]+?)\s*<\/button>/g)].map((m) => m[1]);
    assert(labels.length >= 3, 'the popup navigation row was not found: ' + labels.length + ' labels');
    const shouty = labels.filter((label) => /\s[A-Z]/.test(label.replace(/\(DNS\)/, '')));
    assert(!shouty.length,
      'these popup buttons are title-cased in a sentence-case row: ' + shouty.join(', '));
  }

  /* Verify & repair used to sit directly under the note explaining Save, with no
     space between them, so it read as the end of that sentence rather than as a
     separate action. */
  {
    const afterNote = popup.slice(popup.indexOf('id="note"'));
    const wrapper = afterNote.match(/<div style="padding:(\d+)px 16px 6px;">\s*<button class="btn" id="verify-repair"/);
    assert(wrapper, 'the Verify & repair wrapper is not where its spacing can be checked');
    assert(Number(wrapper[1]) >= 12,
      'Verify & repair has only ' + wrapper[1] + 'px above it, so it runs into the note');
  }

  assert(/'Notification centre' \+ \(unread \? ', ' \+ unread \+ ' unread' : ''\)/.test(popupJsSrc),
    'the unread count must survive in the accessible name');
  assert(popup.includes('Notification centre'), 'the popup should name the page it opens');

  const content = read('src/content.js');
  assert(content.includes('notificationPreference=type=>'), 'content toasts must consult notification preferences');
  assert(content.includes('notificationPositionStyle=()=>'), 'content toasts must apply the selected corner');
  assert(content.includes('persistent="persistent"===preference.mode'), 'persistent cards must not get an auto-dismiss timer');
  assert(content.includes('soundEnabled:!1'), 'content defaults must keep sound off');
  assert(content.includes('tracker_blocked:{mode:"history"'), 'tracker blocks must default to history only');

  const filesWithLegacyNotifications = ['background-startup.js', 'background-extension-watch.js', 'background-memory.js', 'background-downloads.js'];
  filesWithLegacyNotifications.forEach((file) => {
    assert(!read(file).includes('chrome.notifications.create'), file + ' bypasses the central notification manager');
    assert(read(file).includes('showWardenSystemNotification'), file + ' does not use central notification delivery');
  });

  const store = {
    wardenone_config: {},
    wardenone_notifications: [],
  };
  const calls = { contexts: 0, creates: 0, messages: 0, notifications: [] };
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    INCOGNITO_CONTEXT: false,
    importScripts: (file) => vm.runInContext(read(file), context, { filename: file }),
    localGet: async (key) => {
      if (Array.isArray(key)) return Object.fromEntries(key.map((name) => [name, store[name]]));
      return { [key]: store[key] };
    },
    localSet: async (payload) => Object.assign(store, payload),
    chrome: {
      runtime: {
        lastError: null,
        getURL: (file) => 'chrome-extension://test/' + file,
        getContexts: async () => { calls.contexts++; return []; },
        sendMessage: async (payload) => { calls.messages++; calls.lastSound = payload && payload.sound; return { ok: true }; },
      },
      offscreen: { createDocument: async () => { calls.creates++; } },
      notifications: {
        create: (id, options, callback) => { calls.notifications.push({ id, options }); callback(); },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(read('notification-manager.js'), context, { filename: 'notification-manager.js' });

  const defaults = context.wardenNotificationDefaultSettings();
  assert.strictEqual(defaults.version, 4, 'notification defaults must carry the toolbar-badge migration version');
  assert.strictEqual(defaults.defaultDuration, 'reading', 'notifications must default to their measured reading time');
  assert.strictEqual(defaults.soundEnabled, false, 'notification sounds must default off');
  assert.strictEqual(defaults.soundMode, 'important', 'routine sounds must stay gated until the user asks');
  assert.strictEqual(defaults.badgeEnabled, false, 'the pinned toolbar icon must stay clean unless the user opts in');
  assert.strictEqual(defaults.rules.tracker_blocked.mode, 'history', 'tracker spam must default to history only');
  /* Nothing ships waiting for a click. Before the notification centre existed
     every toast faded on a reading-time timer, and adding per-category modes
     quietly turned five of them into notices that sit on the page until you
     deal with them. The history is what makes that safe to undo: a toast you
     miss is still in the centre afterwards, which was not true before. Anyone
     who wants a category to wait can still set it to "Until dismissed". */
  ['dangerous_site', 'password_exposure', 'clickfix_clipboard',
    'suspicious_download', 'protection_failure'].forEach((id) => {
    assert.strictEqual(defaults.rules[id].mode, 'toast', id + ' must not default to waiting for a click');
    assert.strictEqual(defaults.rules[id].duration, 'default',
      id + ' must default to the reading-time length, as it did before the centre');
  });
  assert(!Object.values(defaults.rules).some((r) => r.mode === 'persistent' || r.duration === 'persistent'),
    'a category still ships set to stay on screen until dismissed');
  assert.strictEqual(defaults.rules.protection_list_updated.mode, 'history');

  const migrated = context.sanitizeWardenNotificationSettings({
    version: 2,
    defaultDuration: '5000',
    rules: {
      dangerous_site: { enabled: true, mode: 'persistent', duration: 'persistent', sound: 'critical' },
      password_exposure: { enabled: true, mode: 'persistent', duration: 'persistent', sound: 'critical' },
      clickfix_clipboard: { enabled: true, mode: 'persistent', duration: 'persistent', sound: 'critical' },
      suspicious_download: { enabled: true, mode: 'persistent', duration: 'persistent', sound: 'warning' },
      protection_failure: { enabled: true, mode: 'persistent', duration: 'persistent', sound: 'critical' },
    },
  });
  assert.strictEqual(migrated.defaultDuration, 'reading', 'the old shipped five-second default did not migrate');
  assert.strictEqual(migrated.badgeEnabled, false, 'the old default toolbar count did not migrate to off');
  ['dangerous_site', 'password_exposure', 'clickfix_clipboard',
    'suspicious_download', 'protection_failure'].forEach((id) => {
    assert.strictEqual(migrated.rules[id].mode, 'toast', id + ' kept the old persistent default after migration');
    assert.strictEqual(migrated.rules[id].duration, 'default', id + ' kept the old persistent duration after migration');
  });
  const chosenFiveSeconds = context.sanitizeWardenNotificationSettings({ version: 3, defaultDuration: '5000' });
  assert.strictEqual(chosenFiveSeconds.defaultDuration, '5000', 'an explicit post-migration five-second choice was lost');
  assert.strictEqual(chosenFiveSeconds.badgeEnabled, false, 'version 3 installs must stop showing the toolbar unread count');
  const chosenToolbarBadge = context.sanitizeWardenNotificationSettings({ version: 4, badgeEnabled: true });
  assert.strictEqual(chosenToolbarBadge.badgeEnabled, true, 'the explicit opt-in toolbar count was lost');
  /* ---- nothing may reach the screen from outside the centre --------------- *
   * A notice with no category cannot be turned off, retimed, silenced, grouped
   * or found again afterwards -- the settings page simply has no row for it.
   * Read off the shipped toast table and the real callers, so a type added
   * later fails here instead of quietly becoming the one notice nobody can
   * control. */
  {
    const NEWLINE = String.fromCharCode(10);
    const contentSrc = read('src/content.js');
    const tableStart = contentSrc.indexOf('TOAST_INFO=');
    const tableEnd = contentSrc.indexOf(NEWLINE + '      },', tableStart);
    assert(tableStart >= 0 && tableEnd > tableStart, 'the shipped toast table markers are missing');
    const toastTypes = [...contentSrc.slice(tableStart, tableEnd)
      .matchAll(/^\s{8}([a-z_][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]);
    assert(toastTypes.length >= 60, 'only ' + toastTypes.length + ' toast types found -- the scan broke');

    /* Plus the categories the worker asks for by name, read from the callers
       rather than listed here. */
    const systemTypes = [];
    for (const file of ['background-downloads.js', 'background-extension-watch.js',
      'background-memory.js', 'background-startup.js']) {
      for (const m of read(file).matchAll(/\}\s*,\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) systemTypes.push(m[1]);
    }
    assert(systemTypes.length >= 4, 'the worker notification scan found only ' + systemTypes.length);

    /* Asking only "does it map?" proves nothing: the mapper ends in a catch-all
       that returns system_message for anything, so that question is always yes.
       The question that matters is whether a type reaches its category by an
       actual rule or by falling off the end -- because system_message is
       history-only, and a warning filed there is never shown at all. Fifteen
       were, four of them High, until this check existed. */
    const known = new Set(Object.keys(context.WARDEN_NOTIFICATION_RULES));
    const SYSTEM_BY_INTENT = new Set(['system_message', 'tab_limit_closed', 'startup_review', 'activity_cleanup']);
    const fellThrough = [...new Set(toastTypes.concat(systemTypes))].filter((type) => {
      if (known.has(type)) return false;
      if (SYSTEM_BY_INTENT.has(type)) return false;
      return context.wardenNotificationRuleForType(type) === 'system_message';
    });
    assert(!fellThrough.length,
      'these notices fall through to the history-only system category, so nobody ever sees them: '
      + fellThrough.join(', '));

    /* And the catch-all must stay a catch-all -- if it ever starts returning a
       category that is shown, the check above silently stops meaning anything. */
    assert.strictEqual(context.wardenNotificationRuleForType('a_type_that_does_not_exist'), 'system_message',
      'the fallback category changed; the fall-through check above no longer detects anything');
    assert.strictEqual(context.WARDEN_NOTIFICATION_RULES.system_message.mode, 'history',
      'system messages are no longer history-only, so falling through is no longer silent');

    const hiddenByFallback = toastTypes.filter((type) => type !== 'system_message'
      && context.wardenNotificationRuleForType(type) === 'system_message');
    assert(!hiddenByFallback.length,
      'these page notices fall through to history-only system_message: ' + hiddenByFallback.join(', '));

    /* Content scripts cannot import the worker schema, so they carry a small
       runtime copy. Execute that real copy and compare every rule/default here;
       otherwise the settings page can say "Toast" while the page still waits
       forever, or the centre can categorise a notice the page silently hides. */
    const runtimeStart = contentSrc.indexOf('const NOTIFICATION_RULE_DEFAULTS=');
    const runtimeEnd = contentSrc.indexOf('notificationPositionStyle=', runtimeStart);
    assert(runtimeStart >= 0 && runtimeEnd > runtimeStart, 'content notification runtime markers are missing');
    const runtimeSource = contentSrc.slice(runtimeStart, runtimeEnd).replace(/,\s*$/, ';')
      + '\nthis.__notificationRuleId=notificationRuleId;'
      + '\nthis.__notificationDefaults=NOTIFICATION_RULE_DEFAULTS;'
      + '\nthis.__notificationPreference=notificationPreference;';
    const runtime = {
      DEFAULTS: { notificationSettings: { version: 4, defaultDuration: 'reading' } },
      WO: { notificationSettings: { version: 4, defaultDuration: 'reading', rules: {} } },
    };
    vm.createContext(runtime);
    vm.runInContext(runtimeSource, runtime, { filename: 'content-notification-runtime.js' });

    Object.keys(context.WARDEN_NOTIFICATION_RULES).forEach((id) => {
      const expected = context.WARDEN_NOTIFICATION_RULES[id];
      const actual = runtime.__notificationDefaults[id];
      assert(actual, 'content runtime has no default for ' + id);
      assert.strictEqual(actual.mode, expected.mode, id + ' mode differs between schema and page runtime');
      assert.strictEqual(actual.duration, expected.duration, id + ' duration differs between schema and page runtime');
    });
    toastTypes.forEach((type) => {
      assert.strictEqual(runtime.__notificationRuleId(type), context.wardenNotificationRuleForType(type),
        type + ' maps differently in the page runtime and notification centre');
    });
    assert.strictEqual(runtime.__notificationPreference('warned_phishing').duration, 'reading',
      'the page runtime does not hand default notices to the reading-time calculation');
    runtime.WO.notificationSettings = {
      version: 2,
      defaultDuration: '5000',
      rules: { dangerous_site: { enabled: true, mode: 'persistent', duration: 'persistent' } },
    };
    const oldPageDefault = runtime.__notificationPreference('warned_phishing');
    assert.strictEqual(oldPageDefault.mode, 'toast', 'the content runtime kept the old persistent default');
    assert.strictEqual(oldPageDefault.duration, 'reading', 'the content runtime kept the old fixed five-second default');
  }

  assert.strictEqual(context.wardenNotificationRuleForType('detected_thirdparty_tracker'), 'tracker_blocked');
  assert.strictEqual(context.wardenNotificationRuleForType('extension_change'), 'extension_changed');
  assert.strictEqual(context.wardenNotificationRuleForType('download_review'), 'suspicious_download');
  assert.strictEqual(context.wardenNotificationRuleForType('blocked_popup'), 'suspicious_redirect');

  assert(/bar\.style\.transition = 'transform ' \+ ms \+ 'ms linear'/.test(pageJs),
    'toast preview progress is no longer compositor-animated');
  assert(/requestAnimationFrame\(paint\)/.test(pageJs),
    'toast preview countdown no longer paints on animation frames');
  assert(!/setInterval\([^)]*,\s*60\)/.test(pageJs),
    'toast preview went back to an off-frame 60ms repaint loop');

  await context.recordWardenNotification({ type: 'blocked_popup', url: 'https://example.com/path', at: 1000, detail: { why: 'A popup was stopped.' } });
  await context.recordWardenNotification({ type: 'blocked_popup', url: 'https://example.com/another', at: 2000, detail: { why: 'A popup was stopped again.' } });
  assert.strictEqual(store.wardenone_notifications.length, 1, 'same event and host should group');
  assert.strictEqual(store.wardenone_notifications[0].count, 2, 'group count must increase');
  assert.strictEqual(store.wardenone_notifications[0].host, 'example.com');
  assert.strictEqual(store.wardenone_notifications[0].read, false);
  assert.strictEqual(store.wardenone_notifications[0].samples.length, 2, 'grouped events must remain inspectable');

  await context.recordWardenNotification({ type: 'detected_thirdparty_tracker', url: 'https://youtube.com/', at: 3000, detail: { why: 'doubleverify.com was blocked', matched: 'doubleverify.com' } });
  assert.strictEqual(store.wardenone_notifications[0].ruleId, 'tracker_blocked');
  assert.strictEqual(store.wardenone_notifications[0].mode, 'history');

  await context.playWardenNotificationSoundForType('blocked_popup');
  assert.strictEqual(calls.messages, 0, 'default settings must never play audio');

  store.wardenone_config.notificationSettings = Object.assign({}, defaults, { soundEnabled: true });
  await context.playWardenNotificationSoundForType('blocked_popup');
  assert.strictEqual(calls.messages, 1, 'opted-in sound should reach the offscreen document');
  assert.strictEqual(calls.creates, 1, 'audio should create an offscreen document when needed');

  await context.playWardenNotificationSoundForType('detected_thirdparty_tracker');
  assert.strictEqual(calls.messages, 1, 'history-only tracker events must stay silent');

  /* A refused list update is not a protection failure.
     The integrity check fires when an upstream list is bigger than its cap, has
     drifted a long way from last time, or is simply stale -- and in every case
     WardenOne keeps the list it already had and carries on. Filed under
     protection_failure it inherited critical + persistent, so one grumble from a
     filter host put "Protection failure or degraded state" on screen and left it
     there for good. */
  assert.strictEqual(context.wardenNotificationRuleForType('warned_list_integrity'), 'protection_list_updated',
    'a refused list update is being reported as a protection failure again');
  assert.strictEqual(defaults.rules[context.wardenNotificationRuleForType('warned_list_integrity')].mode, 'history',
    'it must not interrupt; it is a note about an update that did not take');

  /* And the things that ARE failures stay failures. */
  ['engine_disabled', 'repair_failed', 'component_error'].forEach((type) => {
    assert.strictEqual(context.wardenNotificationRuleForType(type), 'protection_failure',
      type + ' stopped being treated as a protection failure');
  });

  /* ---- the two races that made sounds "mostly not play" ---------------- */

  /* createDocument resolves when the document exists, not when its scripts have
     run. A message sent straight after can beat offscreen.js to registering its
     listener and come back as "Receiving end does not exist" -- nothing plays,
     nothing explains. One retry, and only for that error. */
  {
    let attempts = 0;
    const realSend = context.chrome.runtime.sendMessage;
    context.chrome.runtime.sendMessage = async (payload) => {
      attempts++;
      if (attempts === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      calls.messages++;
      calls.lastSound = payload && payload.sound;
      return { ok: true };
    };
    const played = await context.playWardenNotificationSound('soft', 0.5);
    assert.strictEqual(played, true, 'a sound lost to the listener not being up yet');
    assert.strictEqual(attempts, 2, 'the send was not retried');
    context.chrome.runtime.sendMessage = realSend;
  }

  /* And a real error must not be retried into silence -- it should surface. */
  {
    const realSend = context.chrome.runtime.sendMessage;
    let tries = 0;
    context.chrome.runtime.sendMessage = async () => { tries++; throw new Error('something else entirely'); };
    let threw = false;
    try { await context.playWardenNotificationSound('soft', 0.5); } catch (_) { threw = true; }
    assert(threw, 'an unrelated failure was swallowed');
    assert.strictEqual(tries, 1, 'an unrelated failure must not be retried');
    context.chrome.runtime.sendMessage = realSend;
  }

  /* Two sounds close together both saw no document and both called
     createDocument; the loser got "Only a single offscreen document may be
     created" and its sound was never heard. */
  {
    const realCreate = context.chrome.offscreen.createDocument;
    const realGet = context.chrome.runtime.getContexts;
    let creates = 0;
    context.chrome.runtime.getContexts = async () => [];
    context.chrome.offscreen.createDocument = async () => {
      creates++;
      if (creates > 1) throw new Error('Only a single offscreen document may be created.');
      await new Promise((r) => setTimeout(r, 10));
    };
    const both = await Promise.all([
      context.playWardenNotificationSound('soft', 0.5).then(() => 'ok', (e) => 'failed: ' + e.message),
      context.playWardenNotificationSound('warning', 0.5).then(() => 'ok', (e) => 'failed: ' + e.message),
    ]);
    assert.deepStrictEqual(both, ['ok', 'ok'], 'a sound was lost to the create race: ' + both.join(' / '));
    context.chrome.offscreen.createDocument = realCreate;
    context.chrome.runtime.getContexts = realGet;
  }

  /* Every sound the settings page can offer must be one the worker will actually
     play. The list used to be written out in three places -- the page's dropdown,
     this validator, and the offscreen player -- so a name added to one of them
     produced a choice the reader could pick and never hear, with nothing to say
     why. There is one list now, and this checks all three ends of it. */
  const palette = context.wardenNotificationSoundIds();
  assert(palette.length >= 6, 'the sound palette has shrunk to ' + palette.length);
  assert(palette.indexOf('none') === 0, 'silent must remain an option');

  for (const id of palette) {
    const before = calls.messages;
    const played = await context.playWardenNotificationSound(id, 0.5);
    const reached = calls.messages > before;
    if (id === 'none') {
      assert.strictEqual(reached, false, 'the silent option must not play anything');
    } else {
      assert(reached, 'the worker refuses "' + id + '", which the page offers');
      const sent = calls.lastSound;
      assert(sent && sent !== 'none', 'no sound name reached the player for ' + id);
    }
    void played;
  }

  /* The first version called the default sound 'notification'; it is 'soft' now.
     Settings saved under the old name have to keep working. */
  const beforeLegacy = calls.messages;
  await context.playWardenNotificationSound('notification', 0.5);
  assert(calls.messages > beforeLegacy, 'settings saved before the rename stopped making a sound');

  /* And an unknown name is still refused rather than played as something else. */
  const beforeJunk = calls.messages;
  await context.playWardenNotificationSound('airhorn', 0.5);
  assert.strictEqual(calls.messages, beforeJunk, 'an unknown sound must not fall back to an audible one');

  /* The tunes have to be distinguishable by shape, not only pitch -- six sounds
     that differ only in frequency are six sounds nobody can tell apart. */
  const specs = context.WARDEN_NOTIFICATION_SOUNDS.filter((entry) => entry.notes.length);
  const shapes = new Set(specs.map((entry) => entry.notes.length + '/' + entry.wave
    + '/' + (entry.notes[0] < (entry.notes[entry.notes.length - 1]) ? 'up' : 'down')));
  assert(shapes.size >= 4, 'the sounds are too alike: only ' + shapes.size + ' distinct shapes');

  const historyOnly = await context.showWardenSystemNotification('activity', { type: 'basic' }, 'activity_cleanup');
  assert.strictEqual(historyOnly, false, 'history-only category must not create a tray notification');
  /* Persistent delivery still has to work -- it is a setting, not dead code --
     so this asks for it explicitly rather than relying on a shipped default. */
  const waiting = context.sanitizeWardenNotificationSettings({
    version: 4,
    rules: { suspicious_download: { mode: 'persistent', duration: 'persistent' } },
  });
  assert.strictEqual(waiting.rules.suspicious_download.mode, 'persistent',
    'a category can no longer be set to wait for a click');

  const offSettings = context.sanitizeWardenNotificationSettings({
    rules: { suspicious_redirect: { mode: 'off' } },
  });
  assert.strictEqual(offSettings.rules.suspicious_redirect.enabled, false);

  console.log('[ok] notification centre tests');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

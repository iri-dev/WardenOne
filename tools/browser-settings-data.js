/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The Settings page (settings.html) in Edge: real switches, the overview, Recently changed,
   Favorites, search, the backup with your lists, clean-up, permissions, API keys, list status,
   number and list settings, and a full reset.
   Run: node tools/browser-settings-data.js
   It drives the unpacked extension in Edge (tools/perf-profile.js), so it runs in CI's
   real-settings-regression job rather than the local gate; tools/test-settings-page.js and
   tools/build-settings-data.js --check are in the gate. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
const ok = (value, label) => { checks++; assert(value, label); };
const same = (a, b, label) => { checks++; assert.deepEqual(a, b, label); };

/* The popup's own import filter, to hold Settings' copy against. */
function between(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  assert(a >= 0 && b > a, 'missing boundary: ' + start);
  return src.slice(a, b);
}
const popupJs = read('popup.js');
const popupCtx = {};
vm.createContext(popupCtx);
vm.runInContext(read('notification-schema.js'), popupCtx);
vm.runInContext(between(popupJs, 'const DEFAULTS = {', 'const IMPORT_SCHEMA').replace(/^const /gm, 'var ') +
  '\nvar IMPORT_SCHEMA = Object.assign({}, IMPORT_ONLY_DEFAULTS, DEFAULTS);\nvar SECRET_FIELD_RE = /Key$/;\n' +
  between(popupJs, 'function sanitizeSiteOverrides(', '\nfunction exportSettings(') +
  between(popupJs, 'function sanitizeImportedSettings(', '\nfunction importSettingsFromFile('), popupCtx);
const headline = Number((/One master switch\. (\d+) protections\./.exec(read('README.md')) || [])[1]);
assert(headline > 100, 'the README headline count');
/* ---- In Edge ---- */
async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-settings-data-'));
  const files = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-settings-file-'));
  let cdp;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', root, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const manifest = JSON.parse(read('manifest.json'));
    let extension = await profile.extensionReady(cdp, port, manifest.version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    async function open(file) {
      const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/${file}` });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
      return { targetId, sessionId };
    }
    let page;
    async function value(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page.sessionId);
      if (result.exceptionDetails) throw new Error(expression.slice(0, 120) + ' -> ' + JSON.stringify(result.exceptionDetails).slice(0, 600));
      return result.result.value;
    }
    async function until(expression, label, ms) {
      const deadline = Date.now() + (ms || 12000);
      while (Date.now() < deadline) {
        try { if (await value(expression)) return; } catch (_) {}
        await sleep(80);
      }
      throw new Error('Timed out waiting for ' + label);
    }
    const stored = (key) => value(`new Promise(r => chrome.storage.local.get(${JSON.stringify(key)}, d => r(d[${JSON.stringify(key)}])))`);
    const store = (obj) => value(`new Promise(r => chrome.storage.local.set(${JSON.stringify(obj)}, () => r(true)))`);
    const text = (sel) => value(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const go = async (id) => { await value(`document.querySelector('#nav [data-go=${id}]').click(); true`); await sleep(120); };
    const prepare = () => value("window.confirm = () => true; window.__errors = []; addEventListener('error', e => __errors.push(String(e.message))); addEventListener('unhandledrejection', e => __errors.push(String(e.reason && e.reason.message || e.reason))); true");

    page = await open('settings.html#page=overview');
    await until('typeof loaded !== "undefined" && loaded === true', 'saved settings to load');
    await prepare();

    /* The page shows what is saved, and its overview counts come from it. */
    const config = await stored('wardenone_config');
    ok(config && typeof config === 'object', 'the worker wrote a config on install');
    ok(await value("document.querySelector('#ov-title').textContent === 'Protection is on.'"), 'the overview says protection is on');
    const facts = await value("[...document.querySelectorAll('#ov-facts .ft')].map(e => e.textContent)");
    const health = await value("ask({ kind: 'protection-health', tabId: -1 })");
    const watching = await value("WATCH_ONLY_KEYS.filter(k => config[k] !== false).length");
    same(facts[0], (health.configuredShields + watching) + ' of ' + (health.totalShields + 3) + ' protections enabled.', 'the count agrees with the worker’s own count, plus the watch-only three');
    same(health.totalShields + 3, headline, 'and its total is the published one');
    ok(await value('SHIELD_KEYS.every(k => pageOfKey[k])'), 'every protection with a switch has a place in Settings');
    ok(/^(\d+ settings? changed from Recommended\.|Every setting matches Recommended\.)$/.test(facts[1]), 'the overview counts changes from Recommended');
    ok(/^(\d+ protections? may affect compatibility\.|Nothing that may affect compatibility is on\.)$/.test(facts[2]), 'the overview counts protections that may affect compatibility');

    /* A switch changed elsewhere shows here without a reload. */
    await store({ wardenone_config: Object.assign({}, config, { deAmp: true }) });
    await until('state.deAmp === true', 'outside change to arrive');

    /* A switch changed here is saved, recorded by the worker, and counted. */
    await go('privacy');
    await value("document.querySelector('.row[data-key=capReferrer] .tg').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.capReferrer === true && d.wardenone_config.deAmp === true)))", 'capReferrer saved without losing deAmp');
    await until("Array.isArray(recent) && recent.some(e => e.key === 'capReferrer' && e.to === true)", 'the worker to record the change');
    ok((await stored('wardenone_settings_recent')).every((e) => !/Key$/.test(e.key)), 'the change list never holds a key');
    await until("(document.querySelector('#nav [data-go=privacy] .n') || {}).hidden === false", 'Privacy’s changed count');
    same(await value("document.querySelector('#nav [data-go=privacy] .n [aria-hidden]').textContent"), '2', 'Privacy shows two settings changed from Recommended');
    ok(await value("document.querySelector('#nav [data-go=privacy] .n .sr').textContent.includes('changed from Recommended')"), 'the count is named for screen readers');
    ok(await value("document.querySelector('#nav [data-go=security] .n').hidden"), 'a category that matches Recommended shows no count');

    await go('recent');
    ok(await value("[...document.querySelectorAll('#pane .row[data-key]')].map(r => r.dataset.key).slice(0, 2).join() === 'capReferrer,deAmp'"), 'Recently changed lists the newest first');
    ok((await text('#pane .row[data-key=capReferrer] .r-meta')).includes('Turned on'), 'each change says what happened');
    ok((await text('#pane .row[data-key=capReferrer] .r-meta')).includes('Privacy › Links'), 'each change says where the setting lives');

    await value("document.querySelector('#nav [data-go=overview]').click(); true");
    await until("document.querySelector('#ov-recent .row[data-key=capReferrer]')", 'the overview’s recent list');
    ok((await value("[...document.querySelectorAll('#ov-facts .ft')].map(e => e.textContent)"))[2].startsWith('1 protection may'), 'Strict referrer protection counts as a compatibility risk');
    await value("document.querySelector('#ov-facts [data-go=compat]').click(); true");
    ok(await value("!!document.querySelector('#pane .row[data-key=capReferrer]')"), 'Review lists the protections that may affect compatibility');
    ok(await value("document.querySelector('#nav [aria-current=page]').dataset.go === 'overview'"), 'the review lists sit under Overview in the sidebar');

    /* Favorites are saved, survive a reload, and list in the order starred. */
    await go('privacy');
    await value("document.querySelector('.row[data-key=blockTrackers] .r-star').click(); document.querySelector('.row[data-key=deAmp] .r-star').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_settings_favorites', d => r(String(d.wardenone_settings_favorites) === 'blockTrackers,deAmp')))", 'favorites saved');
    ok(await value("document.querySelector('.row[data-key=blockTrackers] .r-star').getAttribute('aria-pressed') === 'true'"), 'a starred setting says so');

    /* Look & reading: every choice is saved where WardenOne reads it. */
    await go('look');
    const pick = (choice, label) => value(`document.querySelector('.seg[data-choice=${choice}] [data-value="${label}"]').click(); true`);
    await pick('theme', 'Dark');
    await until("new Promise(r => chrome.storage.local.get('wardenone_theme', d => r(d.wardenone_theme === 'dark')))", 'theme saved');
    ok(await value("localStorage.getItem('wardenone_theme') === 'dark' && document.documentElement.dataset.theme === 'dark'"), 'the theme’s first-paint mirror is written too, and the page follows');
    await pick('density', 'Comfortable');
    await pick('siteCard', 'Counts');
    await until("new Promise(r => chrome.storage.local.get('wardenone_site_card_layout', d => r(d.wardenone_site_card_layout === 'B')))", 'site card saved where the popup reads it');
    await pick('eyeshield', 'Dark');
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldMode === 'dark' && d.wardenone_config.eyeShield === true)))", 'EyeShield Dark saved');
    await store({ wardenone_config: Object.assign({}, await stored('wardenone_config'), { eyeShieldBrightness: 80, eyeShieldWarmth: 30 }) });
    await until("(document.querySelector('[data-custom=eye-adjust]') || {}).textContent.includes('brightness 80%, warmth 30%')", 'values set in the popup are listed');
    ok(await value("document.querySelector('[data-slider=eyeShieldBrightness]').value === '80' && document.querySelector('[data-slider-out=eyeShieldWarmth]').textContent === '30%'"), 'and the sliders follow a change made in the popup');
    await value("document.querySelector('[data-act=eye-reset]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldBrightness === 100 && d.wardenone_config.eyeShieldWarmth === 0 && d.wardenone_config.eyeShieldMode === 'dark' && d.wardenone_config.eyeShield === true)))", 'adjustments reset, mode kept');
    await pick('eyeshield', 'Normal');
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldMode === 'off' && d.wardenone_config.eyeShield === false)))", 'EyeShield off');
    const muted = { blocked_popup: 0, warned_phishing: Date.now() + 3600e3, warned_shortener: Date.now() - 1000 };
    await store({ wardenone_config: Object.assign({}, await stored('wardenone_config'), { toastMutes: muted }) });
    await until("(document.querySelector('[data-custom=silenced]') || {}).textContent.includes('Possible fake site')", 'silenced notifications listed');
    const silenced = await text('[data-custom=silenced]');
    ok(silenced.includes('2 notifications hidden right now') && silenced.includes('Popup blocked') && silenced.includes('Hidden until you show it again'), 'silenced notifications are the real ones, by the names on their cards');
    ok(!silenced.includes('Shortened link'), 'a snooze that has run out is not listed');
    await value("document.querySelector('[data-act=unmute][data-type=blocked_popup]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(!('blocked_popup' in d.wardenone_config.toastMutes) && 'warned_phishing' in d.wardenone_config.toastMutes)))", 'Show again un-silences only that one');

    /* Settings that are a number, a level or a pick from a list. */
    const cfgIs = (test) => `new Promise(r => chrome.storage.local.get('wardenone_config', d => r((${test})(d.wardenone_config))))`;
    const enter = (selector, v) => value(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(String(v))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await go('speed');
    same(await value("document.querySelector('[data-num=tabLimitMinIdleMinutes]').value"), '30', 'a number shows what is saved');
    await enter('[data-num=tabLimitMax]', 500);
    await until(cfgIs('c => c.tabLimitMax === 200'), 'a tab limit past the most allowed is held to it');
    same(await value("document.querySelector('[data-num=tabLimitMax]').value"), '200', 'and the box says what was saved');
    await enter('[data-num=tabLimitMax]', 25);
    await until(cfgIs('c => c.tabLimitMax === 25'), 'tab limit saved');
    await value("document.querySelector('.seg[data-choice=memoryMode] [data-value=Aggressive]').click(); true");
    await until(cfgIs("c => c.memoryMode === 'aggressive'"), 'Memory Shield mode saved');
    await go('ads');
    ok(await value("!!document.querySelector('[data-num=twitchRewindMinutes]')"), 'the full build shows the Rewind length');
    await enter('[data-num=twitchRewindMinutes]', 12);
    await until(cfgIs('c => c.twitchRewindMinutes === 12'), 'Rewind length saved');
    await go('look');
    await enter('[data-slider=eyeShieldBrightness]', 80);
    await until(cfgIs('c => c.eyeShieldBrightness === 80 && c.eyeShield === true'), 'a slider moved turns EyeShield’s own flag on, as in the popup');
    same(await text('[data-slider-out=eyeShieldBrightness]'), '80%', 'the slider says its value');
    await value("document.querySelector('[data-act=eye-reset]').click(); true");
    await until(cfgIs('c => c.eyeShieldBrightness === 100 && c.eyeShield === false'), 'reset puts it back and EyeShield off');
    ok(await value("document.querySelector('[data-pick=noticeSoundMode]').disabled && document.querySelector('[data-slider=noticeVolume]').disabled"), 'sound choices wait for Play sounds');
    await enter('[data-pick=noticePosition]', 'bottom-left');
    await until(cfgIs("c => c.notificationSettings && c.notificationSettings.position === 'bottom-left'"), 'notice position saved');
    await value("document.querySelector('[data-flag=noticeSound]').click(); true");
    await until(cfgIs('c => c.notificationSettings.soundEnabled === true'), 'Play sounds saved');
    await until("!document.querySelector('[data-pick=noticeSoundMode]').disabled", 'sound choices open up');
    await enter('[data-slider=noticeVolume]', 30);
    await until(cfgIs('c => Math.abs(c.notificationSettings.volume - 0.3) < 0.001'), 'volume saved as the worker reads it');
    const notices = await stored('wardenone_config');
    ok(Object.keys(notices.notificationSettings.rules || {}).length > 5 && notices.notificationSettings.position === 'bottom-left', 'each change keeps the rest of the notification settings');

    const epoch = await value('performance.timeOrigin');
    await cdp.send('Page.reload', {}, page.sessionId);
    await until(`performance.timeOrigin > ${epoch} && typeof loaded !== 'undefined' && loaded === true`, 'reload');
    await prepare();
    ok(await value("document.documentElement.dataset.density === 'comfortable' && document.documentElement.dataset.theme === 'dark'"), 'density and theme are remembered after a reload');
    await go('look');
    ok(await value("document.querySelector('.seg[data-choice=siteCard] [data-value=Counts]').getAttribute('aria-pressed') === 'true'"), 'the site card choice shows what is saved');
    await pick('theme', 'Light');
    await pick('density', 'Compact');
    await pick('siteCard', 'One line');
    await until("new Promise(r => chrome.storage.local.get('wardenone_theme', d => r(d.wardenone_theme === 'light')))", 'theme back to Light');
    await go('favorites');
    same(await value("[...document.querySelectorAll('#pane .row[data-key]')].map(r => r.dataset.key)"), ['blockTrackers', 'deAmp'], 'Favorites keeps the starred order after a reload');
    same(await value("document.querySelector('#nav [data-go=favorites] .n [aria-hidden]').textContent"), '2', 'Favorites shows how many it holds');

    /* Search results say where each setting lives and how it is set. */
    await value("document.querySelector('#q').value = 'cookie'; document.querySelector('#q').dispatchEvent(new Event('input')); true");
    const rows = await value(`[...document.querySelectorAll('#pane .search-results .row[data-key]')].map(r => ({
      key: r.dataset.key, state: r.querySelector('[data-st]').textContent, on: r.querySelector('.tg').getAttribute('aria-checked') === 'true',
      crumb: (r.querySelector('.r-crumb') || {}).textContent || '' }))`);
    ok(rows.length >= 5, 'cookie finds several settings');
    ok(rows.every((r) => r.state === (r.on ? 'On' : 'Off')), 'every result shows its current state');
    ok(rows.every((r) => / › /.test(r.crumb)), 'every result shows its category and group');
    const flip = rows.find((r) => r.key === 'blockAllCookies');
    await value("document.querySelector('#pane .row[data-key=blockAllCookies] .tg').click(); true");
    await until("document.querySelector('#pane .row[data-key=blockAllCookies] [data-st]').textContent === " + JSON.stringify(flip.on ? 'Off' : 'On'), 'the state chip to follow the switch');
    ok(await value("!document.querySelector('#pane .row[data-key=blockAllCookies] [data-chg]').hidden === " + (!flip.on)), 'a result changed from Recommended says what Recommended is');
    await value("document.querySelector('#pane .row[data-key=blockAllCookies] .tg').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.blockAllCookies === " + flip.on + ')))', 'blockAllCookies back');
    await value("document.querySelector('#pane .row[data-key=blockAllCookies] .r-crumb').click(); true");
    ok(await value("document.querySelector('#nav [aria-current=page]').dataset.go === 'privacy' && document.activeElement === document.querySelector('.row[data-key=blockAllCookies] .tg')"), 'a result’s category opens the setting in place');

    /* Search reads everyday words, small typos and words in any order, and ranks what most people mean first. */
    const searchFor = async (q) => {
      await value(`document.querySelector('#q').value = ${JSON.stringify(q)}; document.querySelector('#q').dispatchEvent(new Event('input')); true`);
      return value(`({ keys: [...document.querySelectorAll('#pane .search-results > *')].map(e => e.dataset.key || e.dataset.custom || (e.querySelector('[data-choice]') || {}).dataset?.choice || (e.querySelector('[data-custom]') || {}).dataset?.custom || '') })`);
    };
    for (const [q, first] of [['ads', 'adShield'], ['vpn', 'blockWebRTCLeak'], ['pop ups', 'blockForcedPopups'], ['cookies third-party', 'blockThirdPartyCookies'], ['dark mode', 'eyeshield'], ['keep me logged in', 'loginCompatibility']]) {
      same((await searchFor(q)).keys[0], first, '“' + q + '” puts ' + first + ' first');
    }
    ok(await value("!!document.querySelector('#pane .search-results mark')"), 'the matching words are marked');
    const typo = await searchFor('cokie');
    ok(typo.keys.includes('blockThirdPartyCookies') && (await text('#pane')).includes('Showing results for “cookie”, not “cokie”.'), 'a typo is read as the word it was meant to be, and the page says so');
    await searchFor('dark');
    ok(!(await text('#pane')).includes('Showing results for'), 'a short word is never guessed at');
    await searchFor('zzzz qqqq');
    ok((await text('#pane')).includes('Nothing matched.') && !(await value("!!document.querySelector('#pane .search-filters')")), 'nonsense finds nothing, and offers no filters');

    /* Quick filters narrow the results by state, and their counts are what they show. */
    await searchFor('cookie');
    const chipCounts = await value("Object.fromEntries([...document.querySelectorAll('#pane .chip[data-filter]')].map(c => [c.dataset.filter, Number(c.querySelector('.cnt').textContent)]))");
    same(Object.keys(chipCounts), ['all', 'on', 'off', 'changed', 'risk', 'fav'], 'every quick filter is offered');
    same(chipCounts.on + chipCounts.off <= chipCounts.all, true, 'on and off are parts of everything');
    for (const [filter, test] of [['on', "s.on"], ['off', "!s.on"], ['risk', "s.risk"]]) {
      await value(`document.querySelector('#pane .chip[data-filter=${filter}]').click(); true`);
      const shown = await value(`[...document.querySelectorAll('#pane .search-results .row[data-key]')].map(r => ({ key: r.dataset.key, on: r.querySelector('.tg').getAttribute('aria-checked') === 'true', risk: info(r.dataset.key).badge === 'risk' }))`);
      same(shown.length, chipCounts[filter], 'the ' + filter + ' filter shows as many as its count says');
      ok(shown.every((s) => new Function('s', 'return ' + test)(s)), 'and only results that are ' + filter);
      ok(await value(`document.querySelector('#pane .chip[data-filter=${filter}]').getAttribute('aria-pressed') === 'true'`), 'the chosen filter says it is chosen');
      ok((await text('#pane')).includes(chipCounts[filter] + ' of ' + chipCounts.all + ' results ' + { on: chipCounts.on === 1 ? 'is on' : 'are on', off: chipCounts.off === 1 ? 'is off' : 'are off', risk: 'may break sites' }[filter]), 'the summary says what the ' + filter + ' filter kept');
    }
    await searchFor('tracker');
    ok(await value("document.querySelector('#pane .chip[data-filter=risk]').getAttribute('aria-pressed') === 'true'"), 'a filter stays chosen while you type a new search');
    await value("document.querySelector('#pane .chip[data-filter=fav]').click(); true");
    same(await value("[...document.querySelectorAll('#pane .search-results .row[data-key]')].map(r => r.dataset.key)"), ['blockTrackers'], 'Favorites narrows to the starred results');
    ok(await value("[...document.querySelectorAll('#pane .chip[data-filter]')].filter(c => c.disabled).every(c => c.querySelector('.cnt').textContent === '0')"), 'only a filter with nothing in it is greyed out');
    await value("document.querySelector('#pane .chip[data-filter=all]').click(); document.querySelector('#q').value = ''; document.querySelector('#q').dispatchEvent(new Event('input')); true");

    /* Keyboard shortcuts: read from the browser, one row each, and a way to change them. */
    await go('shortcuts');
    await until("!!document.querySelector('[data-custom=shortcuts] [data-command]')", 'the shortcuts from the browser');
    const commands = await value("new Promise(r => chrome.commands.getAll(c => r(c.filter(x => x.name !== '_execute_action').map(x => ({ name: x.name, shortcut: x.shortcut || '', description: x.description })))))");
    const shownKeys = await value("[...document.querySelectorAll('[data-custom=shortcuts] [data-command]')].map(r => ({ name: r.dataset.command, keys: [...r.querySelectorAll('kbd')].map(k => k.textContent).join('+'), name2: r.querySelector('b').textContent, unset: !!r.querySelector('.st.off') }))");
    same(shownKeys.map((r) => r.name), commands.map((c) => c.name), 'every command the browser lists has a row, in its order');
    ok(shownKeys.every((r, i) => r.keys === commands[i].shortcut && r.name2 === commands[i].description && r.unset === !commands[i].shortcut), 'each row shows the key the browser has right now, or says it is not set');
    ok(commands.some((c) => c.shortcut), 'the browser gave at least one suggested key');
    const unset = commands.filter((c) => !c.shortcut && (manifest.commands[c.name] || {}).suggested_key).length;
    same(await value("(document.querySelector('#nav [data-go=shortcuts] .n') || {}).hidden !== false ? 0 : Number(document.querySelector('#nav [data-go=shortcuts] .n [aria-hidden]').textContent)"), unset, 'the sidebar counts suggested shortcuts the browser left unset');
    await value("document.querySelector('[data-act=open-shortcuts]').click(); true");
    let keysTab = null;
    for (const deadline = Date.now() + 8000; !keysTab && Date.now() < deadline; await sleep(100)) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      keysTab = targetInfos.find((t) => t.type === 'page' && /^(chrome|edge):\/\/extensions\/shortcuts/.test(t.url));
    }
    ok(!!keysTab, 'Open the shortcuts page opens the browser’s own shortcuts page');
    if (keysTab) await cdp.send('Target.closeTarget', { targetId: keysTab.targetId });
    ok((await searchFor('hotkeys')).keys.includes('shortcuts'), 'searching hotkeys finds the shortcuts list');
    await value("document.querySelector('#q').value = ''; document.querySelector('#q').dispatchEvent(new Event('input')); true");

    /* A service that needs a key stays off without one, and the page says where to add it. */
    await go('downloads');
    await value("document.querySelector('.row[data-key=urlHaus] .tg').click(); true");
    await until("document.querySelector('#nav [aria-current=page]').dataset.go === 'access' && !!document.querySelector('[data-key-input=urlHaus]')", 'the key editor');
    same((await stored('wardenone_config')).urlHaus, false, 'URLhaus stays off without a key');

    /* Keys: shown by their last four characters only, and removed along with their switches. */
    const withKey = Object.assign({}, await stored('wardenone_config'), { phishTankKey: 'test-key-abcd1234', phishTank: true });
    await store({ wardenone_config: withKey });
    await value("cancelKey(PROVIDERS.find(p => p.id === 'urlHaus')); true");
    await until("(document.querySelector('[data-custom=key-phishTank]') || {}).textContent.includes('ends in 1234')", 'the saved PhishTank key');
    ok(!(await text('#pane')).includes('test-key-abcd'), 'a saved key is never shown in full');
    await value("document.querySelector('[data-act=key-remove][data-provider=phishTank]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.phishTankKey === '' && d.wardenone_config.phishTank === false)))", 'the key and its switch removed');
    ok((await text('[data-custom=key-phishTank]')).includes('No key'), 'the row says the key is gone');

    /* Permissions are read from the browser. */
    ok((await text('[data-custom=perm-sites]')).includes('All sites'), 'site access reads as all sites');
    ok((await text('[data-custom=perm-history]')).includes('Not allowed'), 'the optional history permission is not granted');
    ok((await text('[data-custom=perm-install]')).includes(manifest.permissions.length + ' permissions'), 'the install-time count is the manifest’s');

    /* List status comes from what the worker recorded. */
    const now = Date.now();
    await store({ wardenone_list_meta: { updated: now - 2 * 3600e3, activeCount: 123456, totalCount: 150000, sources: { total: 37, succeeded: 35, failed: 2, failures: [{ url: 'https://lists.example/one.txt', error: 'HTTP 404' }] } } });
    await go('lists');
    await until("(document.querySelector('[data-custom=list-status]') || {}).textContent.includes('35 of 37')", 'list status');
    const status = await text('[data-custom=list-status]');
    ok(status.includes('2 hours ago'), 'the last successful update is shown');
    ok(status.includes((123456).toLocaleString()), 'how much is blocked is shown');
    ok(status.includes('lists.example/one.txt') && status.includes('HTTP 404'), 'sources that failed are named with the reason');
    await store({ wardenone_list_meta: { updated: now - 9 * 864e5, activeCount: 10 } });
    await until("(document.querySelector('[data-custom=list-status] dd.bad') || {}).textContent.includes('out of date')", 'a stale update flagged');
    ok(!/data-mock/.test(await value("document.querySelector('[data-act=lists-update]').outerHTML")), 'Update now is a real button');

    /* Activity history is counted and cleared. */
    await store({ wardenone_history: [{ at: now - 1000, kind: 'test' }, { at: now - 2000, kind: 'test' }, { at: now - 3000, kind: 'test' }] });
    await go('cleanup');
    await until("(document.querySelector('[data-custom=activity]') || {}).textContent.includes('3 events saved')", 'the activity count');
    await value("document.querySelector('[data-act=clear-activity]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_history', d => r(Array.isArray(d.wardenone_history) && d.wardenone_history.length === 0)))", 'activity cleared');
    ok((await text('[data-custom=activity]')).includes('Activity history cleared.'), 'clearing says it worked');

    /* Browsing data goes through the worker's cleaner. */
    await value("cleanPicks.clear(); cleanPicks.add('cache'); choices.range = 'Last hour'; true");
    await value("document.querySelector('[data-act=clean]').click(); true");
    await until("(document.querySelector('[data-custom=result-clean] .msg') || {}).textContent.startsWith('Cleared: cache')", 'cache cleared');

    /* The diagnostics report is the popup's own. */
    await value("document.querySelector('[data-act=diag-prepare]').click(); true");
    await until("(document.querySelector('pre.diag') || {}).textContent && document.querySelector('pre.diag').textContent.startsWith('WardenOne diagnostics')", 'the report', 20000);
    const report = await text('pre.diag');
    ok(report.includes('WardenOne version: ' + manifest.version) && /Protections active: \d+\/\d+/.test(report), 'the report holds the version and the protection count');
    ok(!report.includes('chrome-extension://') && !/https?:\/\//.test(report), 'the report names no address');
    ok(await value("!document.querySelector('[data-act=diag-download]').disabled"), 'it can be downloaded once prepared');

    /* Blocklists & filters: the logger opens, subscriptions and your own rules go through the worker. */
    await go('lists');
    await value("document.querySelector('[data-act=open-logger]').click(); true");
    let logger = null;
    for (const deadline = Date.now() + 8000; !logger && Date.now() < deadline; await sleep(100)) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      logger = targetInfos.find((t) => t.type === 'page' && t.url === `chrome-extension://${extension.id}/logger.html`);
    }
    ok(!!logger, 'Network logger opens the logger');
    if (logger) await cdp.send('Target.closeTarget', { targetId: logger.targetId });
    await until('!subs.loading', 'subscriptions read');
    ok((await text('[data-custom=subscriptions]')).includes('No subscriptions yet.'), 'no subscriptions in a new profile');
    await value("document.querySelector('[data-sub-url]').value = 'http://easylist.to/easylist/easylist.txt'; document.querySelector('[data-act=sub-add]').click(); true");
    await until("(document.querySelector('[data-custom=subscriptions] .msg') || {}).textContent.includes('https')", 'the worker’s https-only answer');
    ok(await value("document.querySelector('[data-sub-url]').value === 'http://easylist.to/easylist/easylist.txt'"), 'a refused address stays in the box to fix');
    await value("document.querySelector('[data-sub-url]').value = ''; true");
    await until('!rules.loading', 'your rules read');
    const ownRules = '||tracker.example^\nexample.org##.ad-banner\n/ads[0-9]+/';
    await value("(() => { const a = document.querySelector('[data-rules-text]'); a.value = " + JSON.stringify(ownRules) + "; a.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-act=rules-save]').click(); return true; })()");
    await until("(document.querySelector('[data-custom=my-rules] .msg') || {}).textContent.startsWith('Saved')", 'rules saved');
    ok((await text('[data-custom=my-rules] .msg')).includes('1 blocking rule and 1 hiding rule in use.') && (await text('[data-custom=my-rules] .msg')).includes('1 line was skipped'), 'saving says what is in use and what was skipped');
    ok((await text('[data-rules-errors]')).includes('Line 3: regular-expression rules are not supported'), 'a line WardenOne can’t use is named with the reason');
    same((await value("ask({ kind: 'user-rules-get' })")).text, ownRules, 'the rules are the worker’s now');

    /* Backup: no keys out, your lists along with the switches, and a file goes back in, accepted exactly as the popup accepts it. */
    await store({ wardenone_config: Object.assign({}, await stored('wardenone_config'), { urlHausKey: 'secret-urlhaus-key', siteOverrides: { 'example.com': { adShield: false, bogus: false } } }) });
    await until("config.urlHausKey === 'secret-urlhaus-key'", 'seeded key');
    for (const message of [{ kind: 'blocklist-add', pattern: 'blocked-site.com', scope: 'forever' }, { kind: 'blocklist-add', pattern: 'tonight-site.com', scope: 'session' },
      { kind: 'script-trust-add', host: 'trusted-scripts.com' }, { kind: 'download-trust-add', host: 'downloads-site.com' },
      { kind: 'firewall-set', site: 'fw-site.com', domain: 'cdn.thirdparty-cdn.com', column: 'script', verdict: 'block' },
      { kind: 'hidden-add', hostname: 'hide-site.com', selector: '.cookie-banner' }]) {
      const res = await value('ask(' + JSON.stringify(message) + ')');
      ok(res.ok, 'seeded ' + message.kind + ': ' + (res.error || 'ok'));
    }
    await go('cleanup');
    await until("(document.querySelector('[data-custom=backup-lists] .counts') || {}).textContent.includes('1 blocked site')", 'the backup counts what it would hold');
    ok((await text('[data-custom=backup-lists] .counts')).includes('1 firewall decision') && (await text('[data-custom=backup-lists] .counts')).includes('3 filter rules'), 'every kind of list is counted');
    same((await value('exportPayload(false)')).lists, undefined, 'unticked, the file holds switches only');
    const payload = await value('exportPayload()');
    ok(payload.format === 'wardenone-settings' && payload.version === 1, 'the file is the popup’s format');
    ok(!Object.keys(payload.settings).some((k) => /Key$/.test(k)) && !JSON.stringify(payload).includes('secret-urlhaus-key'), 'no API key leaves in the file');
    same(payload.settings.siteOverrides, { 'example.com': { adShield: false } }, 'site overrides are cleaned on the way out');
    same(payload.lists.blockedSites, ['blocked-site.com'], 'blocked sites travel, but not one that ends with the session');
    same([payload.lists.trustedScriptSites, payload.lists.trustedDownloadSites], [['trusted-scripts.com'], ['downloads-site.com']], 'trusted sites travel');
    same(payload.lists.firewall, { 'fw-site.com': { 'cdn.thirdparty-cdn.com': { script: 'block' } } }, 'firewall decisions travel');
    same(payload.lists.hiddenElements, { 'hide-site.com': ['.cookie-banner'] }, 'hidden elements travel');
    same(payload.lists.myFilters, ownRules, 'your own rules travel');
    const mine = await value(`sanitizeImportedSettings(${JSON.stringify(payload.settings)})`);
    same(mine, JSON.parse(JSON.stringify(popupCtx.sanitizeImportedSettings(payload.settings))), 'Settings and the popup accept the same file the same way');
    const hostile = { blockTrackers: 'yes', urlHausKey: 'injected', unknownThing: true, allowlist: ['a.com', 7], deAmp: false };
    same(await value(`sanitizeImportedSettings(${JSON.stringify(hostile)})`), JSON.parse(JSON.stringify(popupCtx.sanitizeImportedSettings(hostile))), 'a hand-edited file is filtered the same way too');
    const hostileLists = { blockedSites: ['ok.example', 7, 'x'.repeat(400)], firewall: { 'fw.example': { 'a.example': { script: 'explode' } }, 'not a host': {} }, hiddenElements: { 'h.example': ['.ok', 9] }, filterLists: [{ url: 'http://insecure.example/l.txt' }], scriptShieldMode: 'chaos' };
    same(await value(`cleanLists(${JSON.stringify(hostileLists)})`), { blockedSites: ['ok.example'], trustedScriptSites: [], trustedDownloadSites: [], firewall: {}, hiddenElements: { 'h.example': ['.ok'] }, myFilters: '', filterLists: [], scriptShieldMode: 'normal' }, 'a hand-edited lists section keeps only well-formed entries');
    const exported = path.join(files, 'wardenone-settings.json');
    fs.writeFileSync(exported, JSON.stringify(payload));

    /* Take it all away, then put it back from the file. */
    const capBefore = payload.settings.capReferrer;
    const blockedNow = await value("ask({ kind: 'blocklist-get' })");
    for (const message of blockedNow.items.filter((e) => e.pattern === 'blocked-site.com').map((e) => ({ kind: 'blocklist-remove', id: e.id }))
      .concat([{ kind: 'script-trust-remove', host: 'trusted-scripts.com' }, { kind: 'download-trust-remove', host: 'downloads-site.com' },
        { kind: 'firewall-set', site: 'fw-site.com', domain: 'cdn.thirdparty-cdn.com', column: 'script', verdict: 'default' },
        { kind: 'hidden-remove', hostname: 'hide-site.com', selector: '.cookie-banner' }, { kind: 'user-rules-set', text: '' }])) {
      ok((await value('ask(' + JSON.stringify(message) + ')')).ok, 'removed for the round trip: ' + message.kind);
    }
    await go('privacy');
    await value("document.querySelector('.row[data-key=capReferrer] .tg').click(); true");
    await until(`new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.capReferrer === ${!capBefore})))`, 'capReferrer flipped before import');
    await go('cleanup');
    const { root: doc } = await cdp.send('DOM.getDocument', {}, page.sessionId);
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#import-file' }, page.sessionId);
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [exported] }, page.sessionId);
    await until("(document.querySelector('[data-custom=result-backup] .msg') || {}).textContent.startsWith('From wardenone-settings.json')", 'the import to finish', 30000);
    const outcome = await text('[data-custom=result-backup] .msg');
    ok(/applied \d+ settings?, 1 blocked site, 1 trusted script site, 1 trusted download site, 1 firewall decision, 1 hidden element, 3 filter rules\./.test(outcome), 'the import says what it applied and added: ' + outcome);
    same((await stored('wardenone_config')).capReferrer, capBefore, 'the switch is back');
    same((await stored('wardenone_config')).urlHausKey, 'secret-urlhaus-key', 'importing leaves the saved key alone');
    const back = await value('collectLists()');
    same([back.blockedSites, back.trustedScriptSites, back.trustedDownloadSites], [['blocked-site.com'], ['trusted-scripts.com'], ['downloads-site.com']], 'blocked and trusted sites are back');
    same(back.firewall, payload.lists.firewall, 'the firewall decision is back');
    same(back.hiddenElements, payload.lists.hiddenElements, 'the hidden element is back');
    const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
    same(lines(back.myFilters), lines(ownRules), 'your rules are back');
    await cdp.send('DOM.setFileInputFiles', { nodeId: (await cdp.send('DOM.querySelector', { nodeId: (await cdp.send('DOM.getDocument', {}, page.sessionId)).root.nodeId, selector: '#import-file' }, page.sessionId)).nodeId, files: [exported] }, page.sessionId);
    await until(`(document.querySelector('[data-custom=result-backup] .msg') || {}).textContent !== ${JSON.stringify(outcome)} && !/^Reading|^Adding/.test(document.querySelector('[data-custom=result-backup] .msg').textContent)`, 'a second import to answer');
    const again = await text('[data-custom=result-backup] .msg');
    ok(again.startsWith('Everything in wardenone-settings.json is already here'), 'importing the same file again changes nothing: ' + again);

    /* Sites & exceptions: every list can be added to from the page, each where the popup writes it. */
    await go('sites');
    await until('!siteState.loading', 'saved sites');
    const addTo = (id, text, choice) => value(`(() => { const box = document.querySelector('[data-custom="add-${id}"]'); box.querySelector('[data-add-input]').value = ${JSON.stringify(text)};`
      + (choice ? ` box.querySelector('[data-add-choice]').value = ${JSON.stringify(choice)};` : '') + ` box.querySelector('[data-act=site-add]').click(); return true; })()`);
    const addSaid = (id) => text(`[data-custom="add-${id}"] .msg`);
    const rowFor = (source, idPart) => `[...document.querySelectorAll('#pane [data-site-source="${source}"]')].find((b) => b.dataset.siteId.includes(${JSON.stringify(idPart)}))`;
    await addTo('paused', 'https://www.Pause-Site.com/some/page', '60');
    await until(cfgIs("c => c.allowlistUntil && c.allowlistUntil['pause-site.com'] > Date.now() + 50 * 60e3 && c.allowlistUntil['pause-site.com'] < Date.now() + 61 * 60e3"), 'a one-hour pause, from an address typed with www and a path');
    ok((await addSaid('paused')).includes('pause-site.com is paused for 1 hour'), 'the pause says how long');
    await addTo('paused', 'pause-site.com', '0');
    await until(cfgIs("c => c.allowlist.includes('pause-site.com') && !(c.allowlistUntil || {})['pause-site.com']"), 'a timed pause made permanent');
    await until(`!!${rowFor('paused', 'pause-site.com')}`, 'the paused row');
    await value(`${rowFor('paused', 'pause-site.com')}.click(); true`);
    await until(cfgIs("c => !c.allowlist.includes('pause-site.com')"), 'pause removed');
    await addTo('paused', 'not a site', '60');
    await until(`(document.querySelector('[data-custom="add-paused"] .msg') || {}).textContent.includes('isn’t a site name')`, 'a bad site refused');
    ok(await value(`document.querySelector('[data-custom="add-paused"] [data-add-input]').value === 'not a site'`), 'what was typed stays to fix');
    await value(`document.querySelector('[data-custom="add-paused"] [data-add-input]').value = ''; true`);
    ok(await value(`[...document.querySelectorAll('[data-add-choice="override"] option')].some((o) => o.value === 'removeOverlays') && ![...document.querySelectorAll('[data-add-choice="override"] option')].some((o) => o.value === 'enabled' || o.value === 'blockMalwareSites')`),
      'only protections the popup lets you turn off for one site are offered');
    ok(await value(`[...document.querySelectorAll('[data-add-choice="override"] option')].find((o) => o.value === 'blockTrackers').textContent.endsWith('(in the page)')`), 'a protection with a network part says only its page part goes');
    await addTo('override', 'news-site.com', 'removeOverlays');
    await until(cfgIs("c => c.siteOverrides['news-site.com'] && c.siteOverrides['news-site.com'].removeOverlays === false"), 'one protection off on one site');
    await until(`!!${rowFor('override', 'news-site.com|removeOverlays')}`, 'its row');
    ok((await value(`${rowFor('override', 'news-site.com|removeOverlays')}.textContent`)) === 'Turn back on', 'and it can be turned back on');
    await value(`${rowFor('override', 'news-site.com|removeOverlays')}.click(); true`);
    await until(cfgIs("c => !c.siteOverrides['news-site.com']"), 'turned back on, and the empty site entry gone');
    await addTo('blocked', 'later-site.com', 'tomorrow');
    await until(`ask({ kind: 'blocklist-get' }).then((r) => r.items.some((e) => e.pattern === 'later-site.com' && e.scope === 'tomorrow'))`, 'a block until tomorrow');
    await addTo('trusted', 'cdn.scripts-site.com');
    await until(`ask({ kind: 'script-trust-list' }).then((r) => r.items.includes('cdn.scripts-site.com'))`, 'a trusted script site');
    await addTo('downloads', 'files-site.com');
    await until(`ask({ kind: 'download-trust-list' }).then((r) => r.items.includes('files-site.com'))`, 'a trusted download site');
    await until(`!!${rowFor('downloads', 'files-site.com')}`, 'its row');
    await value(`${rowFor('downloads', 'files-site.com')}.click(); true`);
    await until(`ask({ kind: 'download-trust-list' }).then((r) => !r.items.includes('files-site.com'))`, 'download trust removed');
    await addTo('neversleep', 'music-site.com');
    await until(cfgIs("c => (c.memoryNeverSleepHosts || []).includes('music-site.com')"), 'a site kept awake');
    await until(`!!${rowFor('neversleep', 'music-site.com')}`, 'its row');
    await value(`${rowFor('neversleep', 'music-site.com')}.click(); true`);
    await until(cfgIs("c => !(c.memoryNeverSleepHosts || []).includes('music-site.com')"), 'never-sleep removed');
    ok(!!(await value("ask({ kind: 'hidden-add', hostname: 'zap-site.com', selector: '.cookie-nag' })")).ok, 'seeded a hidden element');
    await until(`!!${rowFor('hidden', 'zap-site.com')}`, 'the hidden-elements row');
    ok((await value(`${rowFor('hidden', 'zap-site.com')}.closest('.row').textContent`)).includes('1 hidden element: .cookie-nag'), 'it names what is hidden');
    await value(`${rowFor('hidden', 'zap-site.com')}.click(); true`);
    await until(`!(${rowFor('hidden', 'zap-site.com')})`, 'brought back');
    ok((await value("ask({ kind: 'hidden-list', hostname: 'zap-site.com' })")).selectors.length === 0, 'the worker forgot it');
    await addTo('firewall', 'fw-site.com');
    let fwTab = null;
    for (const deadline = Date.now() + 8000; !fwTab && Date.now() < deadline; await sleep(100)) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      fwTab = targetInfos.find((t) => t.type === 'page' && t.url === `chrome-extension://${extension.id}/firewall.html?site=fw-site.com`);
    }
    ok(!!fwTab, 'the firewall opens for the typed site');
    if (fwTab) await cdp.send('Target.closeTarget', { targetId: fwTab.targetId });

    /* Needs attention: the health check's own items, each with a way to put it right. */
    await store({ wardenone_config: Object.assign({}, await stored('wardenone_config'), { blockMalwareSites: false }) });
    await value("document.querySelector('#nav [data-go=overview]').click(); scheduleHealth(); true");
    await until("(document.querySelector('#ov-attention') || {}).textContent && document.querySelector('#ov-attention').textContent.includes('Known malicious-site blocking is turned off.')", 'the health check’s item', 15000);
    ok(await value("!document.querySelector('#ov-attention-sec').hidden && !!document.querySelector('#ov-attention [data-reveal=blockMalwareSites]')"), 'it offers the setting that fixes it');
    ok(/^\d+ things? needs? attention\.$/.test(await value("[...document.querySelectorAll('#ov-facts .ft')].pop().textContent")), 'the overview counts what needs attention');
    ok(await value("!document.querySelector('#nav [data-go=overview] .n').hidden && document.querySelector('#nav [data-go=overview] .n .sr').textContent.includes('attention')"), 'and so does the sidebar');
    await value("document.querySelector('#ov-attention [data-reveal=blockMalwareSites]').click(); true");
    ok(await value("document.querySelector('#nav [aria-current=page]').dataset.go === 'lists' && document.activeElement === document.querySelector('.row[data-key=blockMalwareSites] .tg')"), 'Show the setting goes straight to it');
    await value("document.activeElement.click(); true");
    await until(cfgIs('c => c.blockMalwareSites === true'), 'turned back on');
    await value("document.querySelector('#nav [data-go=overview]').click(); true");
    await until("!document.querySelector('#ov-attention').textContent.includes('Known malicious-site blocking')", 'the item goes once it is fixed', 15000);
    await go('cleanup');
    await value("document.querySelector('[data-custom=repair] [data-act=repair]').click(); true");
    await until("/^(All healthy|Checked \\d+ part)/.test((document.querySelector('[data-custom=repair] .msg') || {}).textContent || '')", 'Verify & repair to answer', 60000);

    /* Presets write real settings. */
    await value("document.querySelector('#nav [data-go=overview]').click(); true");
    await value("document.querySelector('.preset-line [data-preset=rec]').click(); true");
    await until("[...document.querySelectorAll('#ov-facts .ft')].map(e => e.textContent)[1] === 'Every setting matches Recommended.'", 'Recommended applied');
    const rec = await stored('wardenone_config');
    ok(rec.capReferrer === false && rec.deAmp === false, 'Recommended turned the extra protections off in storage');

    /* The master switch. */
    await value("document.querySelector('#master').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.enabled === false)))", 'paused');
    ok(await value("document.querySelector('#ov-title').textContent === 'Protection is paused.' && !document.querySelector('#ov-resume').hidden && document.querySelector('#app').classList.contains('paused')"), 'the overview says paused and offers to resume');
    same(await text('#ov-facts .ft'), 'None of the ' + headline + ' protections are running while WardenOne is paused.', 'paused, no protection is counted as on');
    await value("document.querySelector('#ov-resume').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.enabled === true)))", 'resumed');
    ok(await value("document.querySelector('#ov-resume').hidden"), 'the resume button hides once protection is on');

    same(await value('window.__errors'), [], 'no page errors');

    /* Reset everything but switches and keys: the worker erases, restarts, and keeps only those. */
    await store({ wardenone_config: Object.assign({}, await stored('wardenone_config'), { deAmp: true, allowlist: ['paused.example'] }) });
    await go('cleanup');
    await value("document.querySelector('input[name=erase-mode][value=\"settings-and-keys\"]').click(); true");
    await value("document.querySelector('[data-act=erase-review]').click(); true");
    await until("!!document.querySelector('[data-act=erase-go]')", 'the erase confirmation');
    ok((await text('[data-custom=erase] .confirm-box')).includes('Your switches and API keys are kept'), 'the confirmation says what stays');
    await value("document.querySelector('[data-act=erase-go]').click(); true");
    /* The restart closes every extension page; wait for that before looking, or the old
       instance may still be part-way through its erase. */
    const closesBy = Date.now() + 60000;
    for (;;) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      if (!targetInfos.some((t) => t.targetId === page.targetId)) break;
      if (Date.now() > closesBy) throw new Error('the Settings tab did not close after the reset');
      await sleep(200);
    }
    await sleep(1000);
    extension = await profile.extensionReady(cdp, port, manifest.version);
    page = await open('settings.html#page=overview');
    await until('typeof loaded !== "undefined" && loaded === true', 'Settings after the reset');
    const kept = await stored('wardenone_config');
    ok(kept.deAmp === true && kept.urlHausKey === 'secret-urlhaus-key', 'switches and keys survived');
    ok(!kept.allowlist || !kept.allowlist.length, 'site exceptions were erased');
    same(await stored('wardenone_settings_favorites'), undefined, 'favorites were erased');

    console.log('[ok] Settings data management, overview and navigation: ' + checks + ' checks in Edge');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    for (const tmp of [dir, files]) {
      const resolved = path.resolve(tmp);
      if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-settings-(data|file)-/.test(path.basename(resolved))) {
        try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
      }
    }
  }
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

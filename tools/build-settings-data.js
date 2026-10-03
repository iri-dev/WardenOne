/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Builds settings-data.js: the Settings page's copies of tables that are written down elsewhere.
 * Run: node tools/build-settings-data.js           write settings-data.js
 *      node tools/build-settings-data.js --check   the gate: fail if settings-data.js is stale
 *
 * The Settings page used to carry a copy of these made once by hand, and nothing noticed when
 * the popup gained a switch or reworded one. Every table is now read from where it lives:
 *
 *   popup.html                  every switch, the section it sits in, its name and explanation
 *   popup.js                    DEFAULTS, IMPORT_ONLY_DEFAULTS (what a backup may hold), TOAST_TITLES
 *   background.js               DEFAULT_CONFIG's switch defaults, the Recommended and Maximum
 *                               privacy bundles, HEALTH_SHIELD_KEYS and WATCH_ONLY_GUARDS
 *   docs/source-inventory.json  the public sources behind each list, for the Sources summary
 *   build-profile.js            which settings belong to a utility the Store package leaves out
 *
 * What popup.html marks for the Store package to strip (STORE-OMIT-*), and the settings of a
 * utility the Store leaves out, are written into one marked block of their own, so the package
 * strips them from settings-data.js the same way.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'settings-data.js');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const OMIT_BEGIN = '/* STORE-OMIT-TWITCH-BEGIN */\n';
const OMIT_END = '/* STORE-OMIT-TWITCH-END */\n';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', times: '×', rarr: '→', larr: '←', middot: '·', bull: '•', reg: '®', trade: '™', copy: '©' };
function text(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
      if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/* A `{ ... }` or `[ ... ]` literal that starts at the end of `marker`, evaluated on its own. */
function literal(src, marker, file, sandbox) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(file + ': cannot find ' + marker);
  const open = at + marker.length - 1;
  const close = src[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) return JSON.parse(JSON.stringify(vm.runInNewContext('(' + src.slice(open, i + 1) + ')', sandbox || {})));
  }
  throw new Error(file + ': unbalanced ' + marker);
}

/* Every switch in the popup: a checkbox in a .tg toggle, keyed by data-key, or by id for the few
   the popup wires itself. Each takes the section heading above it and its own row's words. */
function popupSwitches(html) {
  const omitted = [];
  for (const m of html.matchAll(/<!-- STORE-OMIT-([A-Z-]+)-BEGIN -->[\s\S]*?<!-- STORE-OMIT-\1-END -->/g)) omitted.push([m.index, m.index + m[0].length]);
  const headings = Array.from(html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)).map((m) => ({ at: m.index, title: text(m[1]) }));
  /* A row is any div whose class list holds "row", wherever the attribute sits in the tag. */
  const rowStarts = Array.from(html.matchAll(/<div\b[^>]*\bclass="(?:[^"]*\s)?row(?:\s[^"]*)?"[^>]*>/g)).map((m) => m.index);
  const rows = [];
  for (const m of html.matchAll(/<label class="tg"[^>]*>\s*<input\b([^>]*)>/g)) {
    const attrs = m[1];
    if (!/type="checkbox"/.test(attrs)) continue;
    const dataKey = /data-key="([^"]+)"/.exec(attrs);
    const id = /\bid="([^"]+)"/.exec(attrs);
    const key = dataKey ? dataKey[1] : id ? id[1] : '';
    /* The master switch is the page's own control, drawn in its header. */
    if (!key || key === 'enabled') continue;
    const at = m.index;
    const rowStart = rowStarts.filter((i) => i < at).pop();
    const chunk = html.slice(rowStart === undefined ? Math.max(0, at - 3000) : rowStart, at);
    const name = /class="name"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
    const desc = /class="desc"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
    const heading = headings.filter((h) => h.at < at).pop();
    rows.push({
      section: heading ? heading.title : '',
      key, byId: !dataKey,
      name: name ? text(name[1]) : key,
      desc: desc ? text(desc[1]) : '',
      omitted: omitted.some(([a, b]) => at > a && at < b),
    });
  }
  return rows;
}

function sourceSummary(inventory) {
  const sources = Array.isArray(inventory.sources) ? inventory.sources : [];
  const byPurpose = new Map();
  sources.forEach((source) => (Array.isArray(source.purposes) ? source.purposes : []).forEach((purpose) => {
    if (!byPurpose.has(purpose)) byPurpose.set(purpose, []);
    byPurpose.get(purpose).push(source);
  }));
  const feeds = Array.from(byPurpose, ([purpose, list]) => {
    const owners = new Map();
    list.forEach((s) => owners.set(s.owner, (owners.get(s.owner) || 0) + 1));
    const named = Array.from(owners).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'en', { sensitivity: 'base' })).map(([owner]) => String(owner));
    const toggles = new Map();
    list.forEach((s) => { const t = s.toggle || 'always'; toggles.set(t, (toggles.get(t) || 0) + 1); });
    const toggle = Array.from(toggles).sort((a, b) => b[1] - a[1])[0][0];
    return { purpose, count: list.length, owners: named.length > 4 ? named.slice(0, 4).concat('and ' + (named.length - 4) + ' more') : named, toggle };
  });
  feeds.sort((a, b) => b.count - a.count || a.purpose.localeCompare(b.purpose));
  return { feeds, feedTotal: sources.length };
}

function build() {
  const popupHtml = read('popup.html');
  const popupJs = read('popup.js');
  const background = read('background.js');
  const profileCtx = {};
  vm.runInNewContext(read('build-profile.js') + '\nthis.__build = WARDENONE_BUILD;', profileCtx);
  const features = profileCtx.__build.features;
  const omittedKeys = new Set(Object.keys(features).filter((id) => features[id].store === 'omit').flatMap((id) => Array.from(features[id].keys)));

  const switches = popupSwitches(popupHtml);
  const sections = [];
  const carriedRows = [];
  for (const row of switches) {
    const entry = { key: row.key, byId: row.byId, name: row.name, desc: row.desc };
    if (row.omitted || omittedKeys.has(row.key)) { carriedRows.push(Object.assign({ section: row.section }, entry)); continue; }
    let section = sections.find((s) => s.title === row.section);
    if (!section) sections.push(section = { title: row.section, rows: [] });
    section.rows.push(entry);
  }

  const notifications = {};
  vm.runInNewContext(read('notification-schema.js') + '\nthis.__defaults = wardenNotificationDefaultSettings;', notifications);
  const stubs = { wardenNotificationDefaultSettings: notifications.__defaults };
  const defaultConfig = literal(background, 'const DEFAULT_CONFIG = {', 'background.js', stubs);
  const split = (table) => {
    const kept = {}, carried = {};
    Object.keys(table).forEach((k) => { (omittedKeys.has(k) ? carried : kept)[k] = table[k]; });
    return [kept, carried];
  };
  const switchDefaults = {};
  Object.keys(defaultConfig).forEach((k) => { if (typeof defaultConfig[k] === 'boolean') switchDefaults[k] = defaultConfig[k]; });
  const [defaults, carriedDefaults] = split(switchDefaults);

  const popupCtx = {};
  vm.runInNewContext(read('notification-schema.js'), popupCtx);
  const defaultsAt = popupJs.indexOf('const DEFAULTS = {');
  const schemaAt = popupJs.indexOf('const IMPORT_SCHEMA');
  if (defaultsAt < 0 || schemaAt < defaultsAt) throw new Error('popup.js: DEFAULTS and IMPORT_SCHEMA have moved');
  vm.runInNewContext(popupJs.slice(defaultsAt, schemaAt).replace(/^const /gm, 'var '), popupCtx);
  const [popupDefaults, carriedPopupDefaults] = split(JSON.parse(JSON.stringify(popupCtx.DEFAULTS)));
  /* Which protections can be turned off for one site, and how far: page, mixed (the page part
     only) or coordinated. A left-out utility's keys travel with its rows. */
  const siteOverrideScope = {}, carriedScope = {};
  const scope = literal(popupJs, 'const SITE_OVERRIDE_SCOPE = {', 'popup.js');
  Object.keys(scope).forEach((kind) => {
    siteOverrideScope[kind] = scope[kind].filter((k) => !omittedKeys.has(k));
    const carried = scope[kind].filter((k) => omittedKeys.has(k));
    if (carried.length) carriedScope[kind] = carried;
  });

  const data = {
    sections,
    defaults,
    recommended: literal(background, 'const ONBOARDING_RECOMMENDED = {', 'background.js'),
    maxAdds: literal(background, 'const ONBOARDING_MAX_PRIVACY = Object.assign({}, ONBOARDING_RECOMMENDED, {', 'background.js'),
    ...sourceSummary(JSON.parse(read('docs/source-inventory.json'))),
    popupDefaults,
    importOnlyDefaults: JSON.parse(JSON.stringify(popupCtx.IMPORT_ONLY_DEFAULTS)),
    toastTitles: literal(popupJs, 'const TOAST_TITLES = {', 'popup.js'),
    siteOverrideScope,
    shieldKeys: literal(background, 'const HEALTH_SHIELD_KEYS = [', 'background.js'),
    watchOnlyKeys: literal(background, 'const WATCH_ONLY_GUARDS = [', 'background.js'),
    carried: [],
  };
  const lines = Object.keys(data).map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(data[k]));
  let out = read('tools/build-settings-data.js').split('\n').slice(0, 6).join('\n') + '\n'
    + '/* Generated by tools/build-settings-data.js from popup.html, popup.js, background.js,\n'
    + '   build-profile.js and docs/source-inventory.json. Do not edit: change those, then run\n'
    + '   node tools/build-settings-data.js. The gate fails while this file is out of date. */\n'
    + "'use strict';\n\n"
    + 'const SETTINGS_DATA = {\n' + lines.join(',\n') + '\n};\n';
  if (carriedRows.length || Object.keys(carriedDefaults).length || Object.keys(carriedPopupDefaults).length || Object.keys(carriedScope).length) {
    out += '\n' + OMIT_BEGIN
      + 'SETTINGS_DATA.carried.push(' + JSON.stringify({ rows: carriedRows, defaults: carriedDefaults, popupDefaults: carriedPopupDefaults, siteOverrideScope: carriedScope }) + ');\n'
      + OMIT_END;
  }
  return out;
}

function main() {
  const next = build();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== next) {
      console.error('settings-data.js is out of date with popup.html, popup.js, background.js or the source inventory. Run: node tools/build-settings-data.js');
      process.exit(1);
    }
    console.log('settings-data.js is current');
    return;
  }
  fs.writeFileSync(OUT, next);
  console.log('wrote settings-data.js (' + next.length + ' bytes)');
}

module.exports = { build, popupSwitches, text };
if (require.main === module) main();

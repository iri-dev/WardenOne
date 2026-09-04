/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Notification Centre page.
 *
 * It owns no rules of its own. The catalogue and the settings shape live in
 * notification-schema.js, shared with the worker, so what this page offers and
 * what the worker honours cannot drift into two different answers.
 *
 * Two things here are worth more than they look.
 *
 * GROUPING. The settings have carried groupSimilar since they were written and
 * nothing implemented it, which on a tracker-heavy site means the history is
 * forty identical lines and the one warning that mattered is somewhere in the
 * middle of them. Repeats of the same kind, on the same site, within an hour,
 * collapse to one line that expands.
 *
 * READ STATE IS NOT DECORATION. Opening the page does not silently clear it,
 * because a count that vanishes before you have looked at what it was counting
 * is worse than no count. The toolbar count is optional; the centre retains the
 * unread state whether or not that count is shown.
 */
'use strict';

const NC = {
  settings: null,
  items: [],
  filter: 'all',
  expanded: new Set(),
};

function hasStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}
function storageGet(keys) {
  if (!hasStorage()) return Promise.resolve({});
  return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
}
function storageSet(value) {
  if (!hasStorage()) return Promise.resolve();
  return new Promise((resolve) => chrome.storage.local.set(value, () => { void chrome.runtime.lastError; resolve(); }));
}
const $ = (id) => document.getElementById(id);

/* ---- the catalogue, from the shared schema ------------------------------- */

function rules() {
  return (typeof WARDEN_NOTIFICATION_RULES !== 'undefined') ? WARDEN_NOTIFICATION_RULES : {};
}
function sections() {
  return (typeof WARDEN_NOTIFICATION_SECTIONS !== 'undefined') ? WARDEN_NOTIFICATION_SECTIONS : [];
}
function defaults() {
  return (typeof wardenNotificationDefaultSettings === 'function')
    ? wardenNotificationDefaultSettings() : { rules: {} };
}
function sanitize(raw) {
  return (typeof sanitizeWardenNotificationSettings === 'function')
    ? sanitizeWardenNotificationSettings(raw) : defaults();
}

/* Drawn rather than typed. Every other WardenOne page uses inline stroked SVG;
   this one used emoji, which is why it read as a homemade page next to the rest
   -- emoji also change shape per platform and are the one glyph a font stack
   cannot control. Same 24-box, same 2px stroke, same currentColor as popup.html,
   so the icons take the row's tone for free. */
const ICON_PATHS = {
  shield: ['M12 3l7 3v5.2c0 4.4-3 7.6-7 8.8-4-1.2-7-4.4-7-8.8V6z'],
  link: ['M10 13a5 5 0 0 0 7.4.4l2.2-2.2a5 5 0 0 0-7-7l-1.3 1.2',
         'M14 11a5 5 0 0 0-7.4-.4l-2.2 2.2a5 5 0 0 0 7 7l1.3-1.2'],
  key: ['circle:8,15,3', 'M10.3 12.7L20 3M17.2 5.8l2 2M14.6 8.4l2 2'],
  clipboard: ['M9 4.5h6v3H9z', 'M9 6H6.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H15'],
  download: ['M12 3.5v11m0 0l-3.8-3.8M12 14.5l3.8-3.8', 'M4.5 19.5h15'],
  redirect: ['M4.5 17.5h8.5a4 4 0 0 0 4-4V6.5', 'M13.8 9.7l3.2-3.2 3.2 3.2'],
  eye: ['M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12Z', 'circle:12,12,2.6'],
  fingerprint: ['M12 10.2a2 2 0 0 1 2 2v3.4', 'M8.4 12.2a3.6 3.6 0 0 1 6.4-2.2',
                'M5.4 9.8a8 8 0 0 1 13.2 1.4', 'M10.8 20.6a12 12 0 0 0 1.2-4.6'],
  globe: ['circle:12,12,9', 'M3.2 12h17.6', 'M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20.2 4v4.2H16'],
  extension: ['M9.2 4.6a2.2 2.2 0 0 1 4.4 0v.9h2.9a1 1 0 0 1 1 1v2.9h.9a2.2 2.2 0 0 1 0 4.4h-.9v2.9a1 1 0 0 1-1 1h-2.9v-.9a2.2 2.2 0 0 0-4.4 0v.9H6.3a1 1 0 0 1-1-1v-2.9h-.9a2.2 2.2 0 0 1 0-4.4h.9V6.5a1 1 0 0 1 1-1h2.9z'],
  error: ['circle:12,12,9', 'M12 7.6v5.2', 'M12 16.2v.1'],
  flask: ['M9.2 3.2h5.6', 'M10.2 3.4v6L5 18a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5.2-8.6v-6', 'M7.6 15.4h8.8'],
  settings: ['circle:12,12,3.1', 'M12 2.4v2M12 19.6v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.4 12h2M19.6 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  search: ['circle:11,11,6.6', 'M15.8 15.8L20 20'],
  bell: ['M18 9.6a6 6 0 1 0-12 0c0 5.4-2 6.6-2 6.6h16s-2-1.2-2-6.6', 'M10.4 19.6a2 2 0 0 0 3.2 0'],
};

/* Interface glyphs, kept apart from the category set above so a check that
   every category has an icon is not satisfied by a play triangle. */
const UI_ICON_PATHS = {
  play: ['M9.7 7.1l7 4.9-7 4.9z'],
  timer: ['circle:12,13.6,7.4', 'M12 10.2v3.4l2.2 1.5', 'M9.6 3.4h4.8', 'M12 3.6v2.6'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function iconSvg(name) {
  const parts = ICON_PATHS[name] || UI_ICON_PATHS[name] || ICON_PATHS.bell;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  parts.forEach((part) => {
    if (part.indexOf('circle:') === 0) {
      const n = part.slice(7).split(',');
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', n[0]); c.setAttribute('cy', n[1]); c.setAttribute('r', n[2]);
      svg.appendChild(c);
      return;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', part);
    svg.appendChild(path);
  });
  return svg;
}


/* ---- sounds --------------------------------------------------------------- */

function soundChoices() {
  if (typeof WARDEN_NOTIFICATION_SOUNDS !== 'undefined') return WARDEN_NOTIFICATION_SOUNDS;
  return [{ id: 'none', label: 'Silent' }];
}

function playSound(id) {
  if (!id || id === 'none') return;
  try {
    chrome.runtime.sendMessage({
      kind: 'notification-sound-preview',
      sound: id,
      volume: NC.settings.volume,
    }, () => { void chrome.runtime.lastError; });
  } catch (_) {}
}

/* ---- time ---------------------------------------------------------------- */

function ago(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now.getTime() - 86400000);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ---- grouping ------------------------------------------------------------ */

const GROUP_WINDOW_MS = 60 * 60 * 1000;

/* Same kind, same site, within the hour. Deliberately not "same kind, ever":
   two tracker blocks on the same site a day apart are two things that happened,
   and folding them would misreport when. */
function groupItems(items, on) {
  if (!on) return items.map((it) => ({ head: it, all: [it] }));
  const out = [];
  const index = new Map();
  items.forEach((it) => {
    const key = it.type + '|' + (it.host || '');
    const prior = index.get(key);
    if (prior && Math.abs(prior.head.at - it.at) < GROUP_WINDOW_MS) { prior.all.push(it); return; }
    const entry = { head: it, all: [it] };
    index.set(key, entry);
    out.push(entry);
  });
  return out;
}

/* ---- rendering the list -------------------------------------------------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderList() {
  const host = $('nc-list');
  host.textContent = '';
  const cat = rules();

  const visible = NC.items.filter((it) => {
    if (NC.filter === 'all') return true;
    const def = cat[it.type];
    return def && def.section === NC.filter;
  });

  if (!visible.length) {
    const e = el('div', 'empty');
    e.appendChild(el('strong', null, NC.items.length ? 'Nothing in this group' : 'All quiet'));
    e.appendChild(el('div', null, NC.items.length
      ? 'Nothing of this kind has come through. Try another filter.'
      : 'Anything WardenOne tells you will stay here, even after the toast has gone.'));
    host.appendChild(e);
    return;
  }

  let lastDay = '';
  groupItems(visible, NC.settings.groupSimilar).forEach((group) => {
    const it = group.head;
    const day = dayLabel(it.at);
    if (day !== lastDay) { host.appendChild(el('div', 'day', day)); lastDay = day; }

    const def = cat[it.type] || {};
    const sev = def.severity || 'info';
    const row = el('div', 'item sev-' + sev + (it.read ? '' : ' unread'));
    row.appendChild(el('div', 'rail'));
    const ic = el('div', 'ic');
    ic.appendChild(iconSvg(def.icon));
    row.appendChild(ic);

    const body = el('div', 'body');
    const title = el('div', 't');
    title.appendChild(el('span', null, it.title || def.label || 'Notice'));
    if (group.all.length > 1) title.appendChild(el('span', 'count', '×' + group.all.length));
    body.appendChild(title);

    if (it.message) body.appendChild(el('div', 'm', it.message));

    const meta = el('div', 'meta');
    if (it.host) meta.appendChild(el('span', null, it.host));
    meta.appendChild(el('span', null, ago(it.at)));
    body.appendChild(meta);

    if (group.all.length > 1) {
      const key = it.type + '|' + (it.host || '') + '|' + it.at;
      const open = NC.expanded.has(key);
      const btn = el('button', 'more', open ? 'Hide the individual events' : 'Show all ' + group.all.length);
      btn.addEventListener('click', () => {
        if (open) NC.expanded.delete(key); else NC.expanded.add(key);
        renderList();
      });
      body.appendChild(btn);
      if (open) {
        const ul = el('ul', 'sublist');
        group.all.forEach((sub) => {
          const li = document.createElement('li');
          li.appendChild(el('span', null, sub.message || sub.title || 'Event'));
          li.appendChild(el('span', null, ago(sub.at)));
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }
    }

    row.appendChild(body);
    host.appendChild(row);
  });
}

function renderBadge() {
  const unread = NC.items.filter((i) => !i.read).length;
  /* The three tiles in the hero, matching the shape every other WardenOne page
     uses for its summary numbers. */
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const today = NC.items.filter((i) => i.at >= startOfToday.getTime()).length;
  const set = (id, value) => { const n = $(id); if (n) n.textContent = String(value); };
  set('stat-unread', unread);
  set('stat-today', today);
  set('stat-total', NC.items.length);
  $('nc-read').disabled = unread === 0;
  $('nc-clear').disabled = NC.items.length === 0;
}

/* ---- rendering the per-category rules ------------------------------------ */

function renderRules() {
  const host = $('nc-rules');
  host.textContent = '';
  const cat = rules();

  sections().forEach((section) => {
    const ids = Object.keys(cat).filter((id) => cat[id].section === section.id);
    if (!ids.length) return;
    const card = el('div', 'panel');
    card.id = 'sec-' + section.id;
    /* Wrapped the way the static panels are. Built without it, the heading
       loses the panel-head band and the section title reads as pale text
       floating above the rows. */
    const head = el('div', 'panel-head');
    const h = el('h2', null, section.label);
    h.appendChild(el('span', 'sub', section.description));
    head.appendChild(h);
    card.appendChild(head);

    /* Four controls in a line with nothing naming them is a row of guesses --
       the second dropdown in particular could be anything. Real settings screens
       label their columns, so this one does too. */
    const colhead = el('div', 'rulehead');
    ['Notice', 'Show as', 'Time on screen', 'Sound'].forEach((label) => {
      colhead.appendChild(el('span', null, label));
    });
    card.appendChild(colhead);

    ids.forEach((id) => {
      const def = cat[id];
      const rule = NC.settings.rules[id] || {};
      const row = el('div', 'row rulerow');

      const grow = el('div', 'grow');
      grow.appendChild(el('div', 'name', def.label));
      grow.appendChild(el('div', 'desc', def.description));
      row.appendChild(grow);

      /* How it reaches you, including the option of not reaching you at all.
         "History only" is the one that makes the noisy categories usable: the
         event is still recorded, it just does not interrupt. */
      const mode = document.createElement('select');
      [['off', 'Off'], ['history', 'History only'], ['toast', 'Toast'], ['persistent', 'Until dismissed']]
        .forEach(([v, label]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = label;
          mode.appendChild(o);
        });
      mode.value = rule.enabled === false ? 'off' : (rule.mode || 'toast');

      const dur = document.createElement('select');
      [['default', 'Default time'], ['3000', '3 seconds'], ['5000', '5 seconds'],
        ['10000', '10 seconds'], ['15000', '15 seconds'], ['persistent', 'Until dismissed']]
        .forEach(([v, label]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = label;
          dur.appendChild(o);
        });
      dur.value = rule.duration || 'default';

      /* Built from the shared palette rather than a list written out here, so a
         sound added to the schema appears without anyone remembering to add it
         in two places. */
      const snd = document.createElement('select');
      soundChoices().forEach((entry) => {
        const o = document.createElement('option');
        o.value = entry.id; o.textContent = entry.label;
        snd.appendChild(o);
      });
      /* 'notification' was the old name for what is now 'soft'. */
      snd.value = (rule.sound === 'notification') ? 'soft' : (rule.sound || 'none');

      /* Hearing it is the only way to choose it. A dropdown of seven names is
         seven guesses otherwise. */
      const hear = el('button', 'act');
      hear.appendChild(iconSvg('play'));
      hear.title = 'Hear this sound';
      hear.setAttribute('aria-label', 'Hear the sound for ' + def.label);
      hear.addEventListener('click', () => playSound(snd.value));

      /* And the same for the length. The default has a Try it; a category that
         overrides the default needs its own, or the one number on the row you
         actually changed is the one you cannot see. Shows a real card carrying
         this category's own title, at this category's own length. */
      const timeIt = el('button', 'act');
      timeIt.appendChild(iconSvg('timer'));
      timeIt.title = 'See how long this one stays';
      timeIt.setAttribute('aria-label', 'See how long ' + def.label + ' stays on screen');
      timeIt.addEventListener('click', () => {
        const value = dur.value === 'default' ? NC.settings.defaultDuration : dur.value;
        previewToast(mode.value === 'persistent' ? 'persistent' : value, NC.settings.position, def.label);
      });

      /* A duration on something that never appears, or a sound on something
         silent, is a control that does nothing. Disabled rather than hidden so
         the row does not change shape as you use it. */
      const sync = () => {
        /* Only "Off" means nothing can ever appear, so only "Off" greys the rest
           of the row out. "History only" used to as well, which meant the four
           categories that ship that way -- trackers, list updates, experimental
           warnings and system messages -- had no editable timing at all: to set
           one you had to switch the category to Toast, set it, and switch it
           back. A setting you cannot reach without turning the thing on first is
           not a setting. Duration stays disabled on "Until dismissed" because
           that mode has no duration by definition. */
        const silent = mode.value === 'off';
        dur.disabled = silent || mode.value === 'persistent';
        snd.disabled = silent || !NC.settings.soundEnabled;
        hear.disabled = snd.disabled || snd.value === 'none';
        timeIt.disabled = silent;
      };
      sync();

      const onChange = () => {
        NC.settings.rules[id] = {
          enabled: mode.value !== 'off',
          mode: mode.value === 'off' ? 'history' : mode.value,
          duration: dur.value,
          sound: snd.value,
        };
        sync();
        save();
      };
      mode.addEventListener('change', onChange);
      dur.addEventListener('change', onChange);
      snd.addEventListener('change', onChange);

      /* Each control carries its own label as well as sitting under the column
         heading. The heading is what names it on a wide screen; the label is what
         names it once the columns stack and the headings are gone. */
      const cell = (label, ...controls) => {
        const box = el('div', 'cell');
        box.appendChild(el('span', 'lbl', label));
        controls.forEach((control) => box.appendChild(control));
        return box;
      };

      row.appendChild(cell('Show as', mode));
      /* The preview button sits inside the column it previews, under that
         column's heading, rather than floating between two dropdowns. */
      const durCell = cell('Time on screen', dur, timeIt);
      row.appendChild(durCell);

      const sndCell = cell('Sound', snd, hear);
      row.appendChild(sndCell);
      card.appendChild(row);
    });
    host.appendChild(card);
  });
}


/* ---- the section nav ------------------------------------------------------ */

/* Built from the same catalogue the panels are, so a section added to the
   schema appears in both or neither. A hand-written list here would be a second
   place to remember, and the one that gets forgotten. */
function renderSettingsNav() {
  const host = $('settings-nav');
  if (!host) return;
  host.textContent = '';

  const add = (id, label) => {
    const a = document.createElement('a');
    a.href = '#' + id;
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      host.querySelectorAll('a').forEach((n) => n.removeAttribute('aria-current'));
      a.setAttribute('aria-current', 'true');
    });
    host.appendChild(a);
    return a;
  };

  const group = (text) => {
    const d = document.createElement('div');
    d.className = 'grp';
    d.textContent = text;
    host.appendChild(d);
  };

  group('General');
  const first = add('sec-behaviour', 'How notices behave');
  add('sec-sound', 'Sound');
  group('Per notice');
  sections().forEach((section) => {
    if (document.getElementById('sec-' + section.id)) add('sec-' + section.id, section.label);
  });
  first.setAttribute('aria-current', 'true');

  /* Which section you are actually looking at, rather than the last one you
     clicked -- otherwise the nav lies the moment anyone scrolls. */
  try {
    const targets = Array.from(host.querySelectorAll('a'))
      .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
      .filter(Boolean);
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        /* setAttribute, not toggleAttribute: toggleAttribute writes an empty
           value, which is not a valid aria-current token and never matches the
           [aria-current="true"] rule that draws the highlight. */
        host.querySelectorAll('a').forEach((n) => {
          if (n.getAttribute('href') === '#' + entry.target.id) n.setAttribute('aria-current', 'true');
          else n.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-10% 0px -70% 0px' });
    targets.forEach((t) => spy.observe(t));
  } catch (_) {}
}

/* ---- preferences --------------------------------------------------------- */

function renderPrefs() {
  const s = NC.settings;
  $('pref-duration').value = s.defaultDuration;
  $('pref-position').value = s.position;
  $('pref-group').checked = s.groupSimilar;
  $('pref-badge').checked = s.badgeEnabled;
  $('pref-retention').value = String(s.retentionDays);
  $('pref-sound').checked = s.soundEnabled;
  $('pref-soundmode').value = s.soundMode;
  const pick = $('pref-soundpick');
  if (pick && !pick.options.length) {
    soundChoices().filter((e) => e.id !== 'none').forEach((entry) => {
      const o = document.createElement('option');
      o.value = entry.id; o.textContent = entry.label;
      pick.appendChild(o);
    });
    pick.value = 'soft';
  }
  if (pick) pick.disabled = !s.soundEnabled;
  $('pref-volume').value = Math.round(s.volume * 100);
  $('pref-volume-label').textContent = Math.round(s.volume * 100) + '%';
  $('pref-soundmode').disabled = !s.soundEnabled;
  $('pref-volume').disabled = !s.soundEnabled;
  $('pref-preview').disabled = !s.soundEnabled;
}

async function save() {
  const stored = await storageGet('wardenone_config');
  const config = (stored.wardenone_config && typeof stored.wardenone_config === 'object') ? stored.wardenone_config : {};
  await storageSet({ wardenone_config: Object.assign({}, config, { notificationSettings: NC.settings }) });
}

async function saveHistory() {
  await storageSet({ wardenone_notifications: NC.items });
}


/* ---- the live timing preview -------------------------------------------- */

/* Borrowed from tools/toast-harness.html, which exists because a duration is
   not a number you can judge -- it is a length of time you have to sit through.
   The harness was a developer page; there is no reason the person choosing the
   setting should not have the same thing.
   It draws a real card, in the corner they picked, for exactly the length they
   picked, with the time left counting down on it. "Until dismissed" gets a card
   with no timer, which is the only honest way to show that setting. */
let tryTimer = 0;
let tryTick = 0;
let tryRaf = 0;

function durationMs(value) {
  if (value === 'persistent') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function previewToast(value, position, title) {
  const previous = document.querySelector('.tryhost');
  if (previous) previous.remove();
  clearTimeout(tryTimer);
  clearInterval(tryTick);
  if (tryRaf) { cancelAnimationFrame(tryRaf); tryRaf = 0; }

  const host = document.createElement('div');
  host.className = 'tryhost ' + (position || 'top-right');
  const card = document.createElement('div');
  card.className = 'trycard';

  const ms = durationMs(value);
  card.appendChild(el('div', 'tt', title || 'Tracker blocked'));
  card.appendChild(el('div', 'tw', 'This is what a WardenOne notice looks like, for exactly as long as you have set.'));
  card.appendChild(el('div', 'tm', ms ? 'Severity: Medium' : 'Severity: Medium — this one waits for you'));

  const count = el('div', 'trycount', '');
  card.appendChild(count);
  const bar = el('div', 'tryprog', '');
  card.appendChild(bar);

  const close = () => {
    clearInterval(tryTick);
    if (tryRaf) { cancelAnimationFrame(tryRaf); tryRaf = 0; }
    card.style.transition = 'opacity .25s, transform .25s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(12%)';
    setTimeout(() => { try { host.remove(); } catch (_) {} }, 260);
  };

  if (ms) {
    /* The bar used to be redrawn from a 60ms interval, which is neither the
       frame rate nor a multiple of it, so the preview stuttered -- and a preview
       of a toast is a claim about how that toast will look. The real toast hands
       the bar to a CSS transition and lets the compositor run it; this does the
       same. The countdown is the only thing left on a timer, and it is written
       from requestAnimationFrame and only when the tenth actually changes. */
    const started = Date.now();
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    /* Read a layout value so the starting frame is committed. Without it the two
       writes collapse into one and the bar begins already empty. */
    void bar.offsetWidth;
    bar.style.transition = 'transform ' + ms + 'ms linear';
    bar.style.transform = 'scaleX(0)';

    let shown = '';
    const paint = () => {
      const left = Math.max(0, ms - (Date.now() - started));
      const text = (left / 1000).toFixed(1) + 's';
      if (text !== shown) { shown = text; count.textContent = text; }
      tryRaf = left > 0 ? requestAnimationFrame(paint) : 0;
    };
    paint();
    tryTimer = setTimeout(close, ms);
  } else {
    bar.style.transform = 'scaleX(1)';
    count.textContent = 'stays';
    const dismiss = el('div', 'tm', 'Click to dismiss');
    card.appendChild(dismiss);
    card.style.cursor = 'pointer';
    card.addEventListener('click', close);
  }

  host.appendChild(card);
  document.body.appendChild(host);
}

/* ---- wiring -------------------------------------------------------------- */

function bindTabs() {
  const show = (which) => {
    const recent = which === 'recent';
    $('tab-recent').setAttribute('aria-selected', String(recent));
    $('tab-prefs').setAttribute('aria-selected', String(!recent));
    $('pane-recent').hidden = !recent;
    $('pane-prefs').hidden = recent;
    document.querySelectorAll('[data-notification-view]').forEach((link) => {
      const active = link.getAttribute('data-notification-view') === (recent ? 'recent' : 'prefs');
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  $('tab-recent').addEventListener('click', () => show('recent'));
  $('tab-prefs').addEventListener('click', () => show('prefs'));
  document.querySelectorAll('[data-notification-view]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const view = link.getAttribute('data-notification-view') === 'prefs' ? 'prefs' : 'recent';
      show(view);
      try { history.replaceState(null, '', view === 'prefs' ? '#preferences' : '#notifications'); } catch (_) {}
    });
  });
  if (location.hash === '#preferences') show('prefs');
}

function bindFilters() {
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      NC.filter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderList();
    });
  });
}

function bindPrefs() {
  const on = (id, event, fn) => { const n = $(id); if (n) n.addEventListener(event, fn); };
  on('pref-duration', 'change', (e) => { NC.settings.defaultDuration = e.target.value; save(); });
  on('pref-position', 'change', (e) => {
    NC.settings.position = e.target.value; save();
    /* Show it where it will actually appear, immediately -- the corner is the
       other half of the same question as the duration. */
    previewToast(NC.settings.defaultDuration, NC.settings.position);
  });
  on('pref-try', 'click', () => previewToast(NC.settings.defaultDuration, NC.settings.position));
  on('pref-group', 'change', (e) => { NC.settings.groupSimilar = e.target.checked; save(); renderList(); });
  on('pref-badge', 'change', (e) => { NC.settings.badgeEnabled = e.target.checked; save(); });
  on('pref-retention', 'change', (e) => { NC.settings.retentionDays = Number(e.target.value); save(); });
  on('pref-sound', 'change', (e) => {
    NC.settings.soundEnabled = e.target.checked;
    save(); renderPrefs(); renderRules();
  });
  on('pref-soundmode', 'change', (e) => { NC.settings.soundMode = e.target.value; save(); });
  on('pref-volume', 'input', (e) => {
    NC.settings.volume = Number(e.target.value) / 100;
    $('pref-volume-label').textContent = e.target.value + '%';
  });
  on('pref-volume', 'change', save);
  on('pref-preview', 'click', () => playSound($('pref-soundpick') ? $('pref-soundpick').value : 'soft'));
}

function bindHistoryControls() {
  $('nc-read').addEventListener('click', async () => {
    NC.items.forEach((i) => { i.read = true; });
    await saveHistory();
    renderList(); renderBadge();
  });
  $('nc-clear').addEventListener('click', async () => {
    if (NC.items.length && !confirm('Clear all ' + NC.items.length + ' notifications from history?')) return;
    NC.items = [];
    await saveHistory();
    renderList(); renderBadge();
  });
  const act = $('nc-activity');
  if (act) {
    act.addEventListener('click', () => {
      try { chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }); } catch (_) {}
    });
  }
}

async function load() {
  const stored = await storageGet(['wardenone_config', 'wardenone_notifications']);
  const cfg = stored.wardenone_config || {};
  NC.settings = sanitize(cfg.notificationSettings);
  const raw = Array.isArray(stored.wardenone_notifications) ? stored.wardenone_notifications : [];
  NC.items = raw
    .filter((i) => i && typeof i === 'object' && Number.isFinite(Number(i.at)))
    .map((i) => ({
      type: String(i.type || 'system'),
      title: String(i.title || ''),
      message: String(i.message || ''),
      host: String(i.host || ''),
      at: Number(i.at),
      read: i.read === true,
    }))
    .sort((a, b) => b.at - a.at);

  renderPrefs();
  renderRules();
  renderSettingsNav();
  renderList();
  renderBadge();
}

bindTabs();
bindFilters();
bindPrefs();
bindHistoryControls();
load();

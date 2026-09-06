/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Type what you want instead of remembering where it lives.
 *
 * WardenOne has more tools than a menu can hold well, and past a certain point FINDING
 * one is the problem rather than lacking one. This is the same answer an editor gives:
 * one key, one box, type a few letters.
 *
 * It is display only. Nothing here decides what a command does, or is trusted about what
 * the reader picked -- the background holds the list and dispatches through exactly the
 * same path the keyboard shortcuts use, and refuses anything not on it. This file could
 * be rewritten by a hostile page and still not be able to reach an action WardenOne would
 * not otherwise have offered.
 *
 * Injected on the shortcut, never standing. There is no reason for a command palette to
 * be resident in every page for the whole of its life, and this way a page cannot even
 * observe that the feature exists until it is asked for.
 *
 * Isolated world, closed shadow root, and every style set on the host: the page cannot
 * read the palette's DOM, cannot restyle it into something misleading, and cannot see
 * what was typed into it.
 *
 * IT KEEPS ITS OWN QUERY STRING RATHER THAN USING AN <input>, and that is not a stylistic
 * choice. A real input needs the keydown to reach it and produce a character, and plenty
 * of pages take single letters for themselves: on YouTube, f j k l and m are fullscreen,
 * seek, play/pause, seek and mute. Its document-level handler sees the key first and
 * calls preventDefault, so those five letters simply never appeared in the box.
 *
 * Stopping propagation does not fix it. This listener runs at window CAPTURE, which is
 * the first step of the journey -- stopping there stops the event reaching the palette's
 * own input as well as the page's handler, so nothing can be typed at all.
 *
 * So the palette reads the keys itself, at the earliest point anything can, keeps the
 * query in a variable and draws it. No page handler can interfere with a string this file
 * owns outright. The cost is that IME composition is not supported; every command here is
 * named in English, so the letters being typed are Latin either way.
 */
(function () {
  'use strict';

  /* Read here, but SET only once the overlay is actually on the page, at the bottom of
     this file. Setting it up front looked equivalent and was not: if anything below threw
     -- one unsupported call on one browser -- the flag stayed true and every later press
     returned here silently, so the palette was dead on that page for the rest of its life.
     "Does nothing" is the hardest failure to tell apart from "the key is not bound", and
     leaving a poisoned flag behind is a good way to manufacture it. */
  if (window.__wardenOnePaletteOpen) return;

  /* The labels only. Which of these actually runs is the background's decision -- this
     list exists so the reader has something to read and filter, not so the page has a
     menu of privileged actions to pick from. */
  const ITEMS = [
    { id: 'scan-site', label: 'Check this site', hint: 'reputation, domain age', keys: 'scan check site reputation domain age' },
    { id: 'privacy-test', label: 'Run the privacy test', hint: 'what can this page read about you', keys: 'privacy test measure fingerprint probe' },
    { id: 'element-tool', label: 'Hide something on this page', hint: 'the element tool — picker and zapper are one tool', keys: 'element picker zapper hide remove zap block annoying' },
    { id: 'copy-clean-current-address', label: 'Copy this page’s address, cleaned', hint: 'tracking parameters removed', keys: 'copy clean url address link utm tracking' },
    { id: 'pause-site', label: 'Pause or resume WardenOne here', hint: 'one hour, this site only', keys: 'pause resume disable off allow site troubleshoot' },
    { id: 'open-network-logger', label: 'Open the network logger', hint: 'what was blocked, and by which rule', keys: 'log logger network requests blocked rule debug' },
    { id: 'open-firewall', label: 'Open the site firewall', hint: 'decide what this site may load', keys: 'firewall matrix per-site allow block requests' },
    { id: 'open-file-shield', label: 'Check a file', hint: 'reads the real bytes, nothing is uploaded', keys: 'file shield scan download exe zip attachment' },
    { id: 'open-extension-check', label: 'Check an extension before installing it', hint: 'paste an ID or store link', keys: 'extension addon check install id webstore' },
    { id: 'open-activity', label: 'Open the activity centre', hint: 'everything WardenOne did, and every block', keys: 'activity history log blocked events blocklist' },
    { id: 'open-settings', label: 'Open WardenOne settings', hint: 'every switch', keys: 'settings options popup switches toggles preferences' },
  ];

  /* Subsequence matching, which is what makes "onl" find "Open the network logger".
     Scored so a run of adjacent letters beats the same letters scattered, and a match on
     the label beats one that only hit the keywords. */
  function score(item, query) {
    const q = query.toLowerCase().replace(/\s+/g, '');
    if (!q) return 1;
    const label = item.label.toLowerCase();
    const hay = label + ' ' + item.keys;
    let best = 0;
    for (const [text, weight] of [[label, 3], [hay, 1]]) {
      let i = 0;
      let hits = 0;
      let run = 0;
      let bestRun = 0;
      for (let c = 0; c < text.length && i < q.length; c++) {
        if (text[c] === q[i]) { i++; hits++; run++; if (run > bestRun) bestRun = run; } else run = 0;
      }
      if (i === q.length) best = Math.max(best, weight * (hits + bestRun * 2));
    }
    return best;
  }

  const host = document.createElement('div');
  host.setAttribute('data-wardenone-palette', '1');
  /* Every property set explicitly. A page-wide `div{position:static!important}` would
     otherwise put the palette somewhere useless, and one that could move it could also
     move it over something it wants clicked. */
  host.style.cssText = 'all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = ':host{all:initial}'
    + '.scrim{position:fixed;inset:0;background:rgba(24,16,34,.38);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}'
    + '.box{width:min(560px,92vw);background:#fdfaff;border:1px solid rgba(176,106,212,.28);border-radius:16px;'
    + 'box-shadow:0 24px 60px rgba(60,25,90,.34);overflow:hidden;font:14px/1.5 "Nunito",ui-sans-serif,system-ui,sans-serif;color:#3d2a52}'
    + '.head{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid rgba(176,106,212,.16)}'
    + '.dot{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#b06fd6,#e07aae);flex:none}'
    + '.brand{font:700 12px "Quicksand","Nunito",sans-serif;color:#8b3fb0;letter-spacing:.02em}'
    + '.q{flex:1;font:15px "Nunito",ui-sans-serif,sans-serif;color:#3d2a52;min-width:0;white-space:pre}'
    + '.q.empty{color:#a98fc0}'
    + '.caret{display:inline-block;width:1px;height:1.05em;background:#8b3fb0;vertical-align:-2px;animation:blink 1.1s step-end infinite}'
    + '@keyframes blink{50%{opacity:0}}'
    + '.list{max-height:46vh;overflow:auto;padding:6px}'
    + '.row{display:flex;align-items:baseline;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer}'
    + '.row[aria-selected="true"]{background:rgba(176,106,212,.16)}'
    + '.name{font-weight:600}'
    + '.hint{font-size:12px;color:#8a75a0;flex:1;text-align:right}'
    + '.none{padding:22px 12px;text-align:center;color:#a98fc0;font-size:13px}'
    + '.foot{padding:8px 14px;border-top:1px solid rgba(176,106,212,.16);font-size:11.5px;color:#8a75a0;'
    + 'display:flex;justify-content:space-between;gap:12px}'
    + '@media (prefers-color-scheme:dark){.box{background:#221a2c;color:#efe4f7;border-color:rgba(176,106,212,.34)}'
    + 'input{color:#efe4f7}.hint,.foot,.none{color:#b9a6c9}}';
  root.appendChild(style);

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const box = document.createElement('div');
  box.className = 'box';
  const head = document.createElement('div');
  head.className = 'head';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'WardenOne';
  const queryText = document.createElement('span');
  queryText.className = 'q empty';
  const caret = document.createElement('span');
  caret.className = 'caret';
  const queryBox = document.createElement('span');
  queryBox.className = 'q';
  queryBox.setAttribute('role', 'textbox');
  queryBox.setAttribute('aria-label', 'WardenOne command palette');
  queryBox.appendChild(queryText);
  queryBox.appendChild(caret);
  head.appendChild(dot);
  head.appendChild(brand);
  head.appendChild(queryBox);
  const list = document.createElement('div');
  list.className = 'list';
  const foot = document.createElement('div');
  foot.className = 'foot';
  const footLeft = document.createElement('span');
  footLeft.textContent = '↑ ↓ to move · Enter to run · Esc to close';
  const footRight = document.createElement('span');
  footRight.textContent = 'Nothing runs until you press it';
  foot.appendChild(footLeft);
  foot.appendChild(footRight);
  box.appendChild(head);
  box.appendChild(list);
  box.appendChild(foot);
  scrim.appendChild(box);
  root.appendChild(scrim);

  let shown = ITEMS.slice();
  let index = 0;
  let query = '';

  function paint() {
    list.textContent = '';
    if (!shown.length) {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = 'Nothing matches that.';
      list.appendChild(none);
      return;
    }
    shown.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === index));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.label;
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = item.hint;
      row.appendChild(name);
      row.appendChild(hint);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); index = i; run(); });
      list.appendChild(row);
    });
    const sel = list.children[index];
    if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ block: 'nearest' }); } catch (_) { /* older engines */ } }
  }

  function filter() {
    queryText.textContent = query || 'Type what you want to do…';
    queryText.className = query ? 'q' : 'q empty';
    shown = ITEMS
      .map((item) => ({ item: item, s: score(item, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item);
    index = 0;
    paint();
  }

  function eat(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function close() {
    /* Every listener, or the page stays deaf to its own keyboard after the palette has
       gone -- which would be a far worse bug than the one this all exists to fix. */
    try { window.removeEventListener('keydown', onKey, true); } catch (_) { /* already gone */ }
    for (const type of ['keypress', 'keyup']) {
      try { window.removeEventListener(type, eat, true); } catch (_) { /* already gone */ }
    }
    try { host.remove(); } catch (_) { /* already gone */ }
    window.__wardenOnePaletteOpen = false;
  }

  function run() {
    const item = shown[index];
    if (!item) return;
    /* The id, and nothing else. The background looks it up in its own list and dispatches
       through the same path the keyboard shortcuts use; a command name invented here
       reaches nothing. */
    try { chrome.runtime.sendMessage({ kind: 'palette-run', command: item.id }, () => { void chrome.runtime.lastError; }); } catch (_) { /* worker asleep */ }
    close();
  }

  function onKey(e) {
    /* While the palette is open every key belongs to it. Swallowed here, at the first
       step of the event's journey, so the page's own single-letter shortcuts never fire:
       without this, typing "km" on YouTube paused the video and muted it. */
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') { run(); return; }
    if (e.key === 'ArrowDown') { index = Math.min(index + 1, shown.length - 1); paint(); return; }
    if (e.key === 'ArrowUp') { index = Math.max(index - 1, 0); paint(); return; }
    if (e.key === 'Backspace') {
      query = (e.ctrlKey || e.metaKey) ? '' : query.slice(0, -1);
      filter();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) { query = ''; filter(); return; }
    /* One printable character. Modifier combinations are left alone -- they belong to the
       browser, and a palette that ate Ctrl+T would be worse than one that ate an f. */
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (query.length < 64) { query += e.key; filter(); }
    }
  }

  /* Capture, on window: the earliest point anything in this document can see a key, which
     is what puts the palette ahead of the page's own handlers rather than behind them.
     keypress and keyup are swallowed too -- a page listening on either would otherwise
     still act on letters the palette has already taken. */
  window.addEventListener('keydown', onKey, true);
  for (const type of ['keypress', 'keyup']) {
    window.addEventListener(type, eat, true);
  }
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });

  (document.body || document.documentElement).appendChild(host);
  /* Set HERE, not at the top: the flag means "a palette is on this page", and until this
     line there is not one. A build that threw earlier leaves the flag clear, so the next
     press tries again instead of returning silently for ever. */
  window.__wardenOnePaletteOpen = true;
  /* filter() rather than paint(): it draws the placeholder as well as the list, and there
     is no focus to take -- the palette reads keys from the window, so nothing has to be
     focused and no page can steal it back. */
  filter();
})();

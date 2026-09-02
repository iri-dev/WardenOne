/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Point at the annoying thing and it goes away.
 *
 * Hides one element, saves its selector immediately, then pauses until the
 * reader presses Done. Reloading must not bring it back; Ctrl+Z restores it and
 * retracts the saved rule with it.
 *
 * There were two of these for a while -- this one, and a "pick" mode that worked
 * out the same selector but showed you what it matched before saving. Two tools
 * for one job: both ended in a saved rule, and the only difference was whether
 * the confirmation arrived before or after the thing disappeared. What the
 * review panel actually contributed was two facts -- how much the rule catches,
 * and whether it is described by position and so likely to break on a redesign.
 * Those are worth knowing whether or not you asked to review, so the panel below
 * says them, and the second mode is gone.
 *
 * Hiding is by ATTRIBUTE, never by removing the node or writing inline styles
 * onto it. One rule in one stylesheet, and every zap on the page is undone by
 * dropping an attribute, so restoring it does not rebuild or clone any of the
 * page's DOM.
 */
(function () {
  'use strict';
  if (window.__wardenOnePickerActive) return;
  window.__wardenOnePickerActive = true;

  const HOST = location.hostname;
  const MAX_DEPTH = 6;
  /* Above this share of the viewport, hiding it is indistinguishable from
     breaking the page, so it takes a second press. */
  const HUGE = 0.85;

  /* ---- the zapper's one stylesheet -------------------------------------- */

  const ZAP_ATTR = 'data-wardenone-zapped';
  const ZAP_STYLE_ID = 'wo-zap-style';
  const zapped = [];
  /* The selectors written for each zap, so undoing on screen also retracts the
     saved rule rather than leaving a thing hidden that the page says is not. */
  const lastSaved = [];

  /* Done closes the picker UI, not the undo window. Keep a page-lifetime stack
     in the isolated extension world so Ctrl+Z can restore the latest zap after
     the overlay has gone, and across later Zapper runs on the same page. */
  const UNDO_STATE_KEY = '__wardenOneZapperUndoState';
  const undoState = (window[UNDO_STATE_KEY] && Array.isArray(window[UNDO_STATE_KEY].items))
    ? window[UNDO_STATE_KEY]
    : { items: [], listener: null };
  window[UNDO_STATE_KEY] = undoState;

  function undoTargetIsEditable(target) {
    try {
      if (!target || target.nodeType !== 1) return false;
      if (/^(input|textarea|select)$/i.test(target.tagName || '')) return true;
      return !!(target.isContentEditable || (target.closest && target.closest('[contenteditable="true"],[contenteditable=""]')));
    } catch (_) { return false; }
  }

  function removeSavedSelector(hostname, sel) {
    try {
      chrome.runtime.sendMessage({ kind: 'hidden-remove', hostname, selector: sel },
        () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  function disarmGlobalUndoIfEmpty() {
    if (undoState.items.length || !undoState.listener) return;
    try { document.removeEventListener('keydown', undoState.listener, true); } catch (_) {}
    undoState.listener = null;
  }

  function undoLatestZapper() {
    const entry = undoState.items.pop();
    if (!entry) return false;
    entry.undoRequested = true;
    try { entry.element.removeAttribute(ZAP_ATTR); } catch (_) {}
    if (entry.saveFinished) removeSavedSelector(entry.hostname, entry.selector);
    disarmGlobalUndoIfEmpty();
    return true;
  }

  function armGlobalUndo() {
    if (undoState.listener) return;
    undoState.listener = (e) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'z' && e.key !== 'Z') || undoTargetIsEditable(e.target)) return;
      if (!undoLatestZapper()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener('keydown', undoState.listener, true);
  }

  function registerZapperUndo(element, sel) {
    const entry = {
      element,
      hostname: HOST,
      selector: sel,
      saveFinished: false,
      undoRequested: false,
    };
    undoState.items.push(entry);
    armGlobalUndo();
    return entry;
  }

  function finishZapperSave(entry) {
    if (!entry) return;
    entry.saveFinished = true;
    /* If Ctrl+Z landed while the write was pending, remove only after that write
       has settled. This prevents a late add from resurrecting an undone rule. */
    if (entry.undoRequested) removeSavedSelector(entry.hostname, entry.selector);
  }

  function ensureZapStyle() {
    if (document.getElementById(ZAP_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = ZAP_STYLE_ID;
    style.textContent = '[' + ZAP_ATTR + '="true"]{display:none!important;}';
    (document.head || document.documentElement).appendChild(style);
  }
  function zap(el) {
    ensureZapStyle();
    el.setAttribute(ZAP_ATTR, 'true');
    zapped.push(el);
  }
  /* ---- what a stable name looks like ------------------------------------ */

  /* Build tooling gives elements names that are unique, descriptive-looking and
     regenerated on every deploy. Using one produces a rule that works until the
     site ships again, which is the worst failure mode available: it stops
     protecting and never says so. */
  const GENERATED = [
    /^(css|sc|jsx|emotion|styled|svelte|jss|makeStyles)[-_][a-z0-9]{4,}$/i,
    /^_ng(content|host)\b/i,
    /^[a-z]{1,3}[-_]?[0-9a-f]{6,}$/i,
    /^[0-9a-f]{8,}$/i,
    /^v-[0-9a-f]{6,}$/i,
  ];
  function looksGenerated(name) {
    const n = String(name || '');
    if (!n) return true;
    if (GENERATED.some((rx) => rx.test(n))) return true;
    /* A long run of mixed digits and letters with no word in it. Deliberately
       conservative: it wants BOTH a digit and enough length before it decides,
       so "h1", "col-6" and "btn-primary" all survive. */
    if (n.length >= 8 && /\d/.test(n) && !/[-_]/.test(n) && !/^[a-z]+$/i.test(n)) return true;
    return false;
  }

  function stableClasses(el) {
    const raw = (el.getAttribute('class') || '').trim();
    if (!raw) return [];
    return raw.split(/\s+/)
      .filter(Boolean)
      .filter((c) => c.length <= 40 && !looksGenerated(c) && /^[a-zA-Z_][\w-]*$/.test(c))
      .slice(0, 3);
  }

  function stableId(el) {
    const id = el.getAttribute('id');
    if (!id || id.length > 60) return '';
    if (!/^[a-zA-Z_][\w-]*$/.test(id)) return '';
    return looksGenerated(id) ? '' : id;
  }

  /* Attributes that describe what a thing IS rather than how it was built.
     These outlive redesigns far more often than class names do. */
  const MEANINGFUL_ATTRS = ['data-testid', 'data-test-id', 'data-qa', 'aria-label', 'role', 'name', 'data-ad-slot'];

  function cssEscape(value) {
    try { return CSS.escape(value); } catch (_) { return String(value).replace(/[^\w-]/g, ''); }
  }

  function ownSelector(el) {
    const tag = el.tagName.toLowerCase();
    const id = stableId(el);
    if (id) return '#' + cssEscape(id);

    for (const attr of MEANINGFUL_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && v.length <= 60 && /^[\w\s-]+$/.test(v)) {
        return tag + '[' + attr + '="' + v.trim() + '"]';
      }
    }

    const classes = stableClasses(el);
    if (classes.length) return tag + '.' + classes.map(cssEscape).join('.');
    return tag;
  }

  function matchCount(sel) {
    try { return document.querySelectorAll(sel).length; } catch (_) { return -1; }
  }

  /* Walk up adding ancestor context only until the selector picks out what was
     actually clicked. Stopping at "unique enough" rather than "fully qualified"
     keeps the rule short, and short rules survive redesigns. */
  /* An unambiguous path by position. Each step names the child index, so the
     result identifies exactly one element as long as the walk reaches something
     nameable -- and body is nameable, so it always terminates. */
  function positionalSelector(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node !== document.body && node !== document.documentElement && depth <= MAX_DEPTH) {
      const parent = node.parentElement;
      if (!parent) break;
      const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      const candidate = ownSelector(parent) + ' > ' + parts.join(' > ');
      if (matchCount(candidate) === 1) return candidate;
      node = parent;
      depth++;
    }
    return parts.length ? 'body > ' + parts.join(' > ') : '';
  }

  function buildSelector(el) {
    let sel = ownSelector(el);
    if (matchCount(sel) === 1) return sel;

    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && node !== document.documentElement && depth < MAX_DEPTH) {
      sel = ownSelector(node) + ' > ' + sel;
      if (matchCount(sel) === 1) return sel;
      node = node.parentElement;
      depth++;
    }

    /* Nothing distinctive anywhere up the chain, so fall back to position.
       This fallback used to be gated on the descriptive selector matching
       NOTHING or MORE THAN EIGHT things, which left everything in between
       returning a rule that hides every match. On a page of avatars that is
       every avatar: hiding one person's picture hid all of them, and the same
       went for a category tile or a stream title. A rule that hides more than
       the thing you pointed at is wrong however few extras it takes with it, so
       anything that is not already unique goes to position now. */
    const positional = positionalSelector(el);
    if (positional && matchCount(positional) === 1) return positional;
    /* Neither is unique. Prefer whichever catches less. */
    if (positional && matchCount(positional) < matchCount(sel)) return positional;
    return sel;
  }

  function isFragile(sel) {
    return sel.indexOf(':nth-child(') >= 0 || /(^|\s|>)(div|span|li|section|p)$/.test(sel.trim());
  }

  /* ---- the overlay ------------------------------------------------------- */

  const ui = document.createElement('div');
  ui.id = 'wo-picker-root';
  const shadow = ui.attachShadow ? ui.attachShadow({ mode: 'closed' }) : null;
  const root = shadow || ui;
  ui.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';

  const style = document.createElement('style');
  style.textContent = [
    /* Positioned by transform, not by left/top, and transitioning ONLY transform.
       `transition:all` over left/top/width/height ran four layout-driven
       transitions on every mouse move, which is why the highlight crawled. */
    '.box{position:fixed;left:0;top:0;border:2px solid #9d54c9;background:rgba(157,84,201,.14);pointer-events:none;border-radius:4px;transition:transform .06s linear;will-change:transform;contain:strict;}',
    '.box.zap{border-color:#e07aae;background:rgba(224,122,174,.16);}',
    /* The panel is WardenOne appearing on somebody else's page, so it says so:
       same violet-to-pink edge, same live dot, same rounded surface as the
       extension's own pages. A plain dark box could be anything, and something
       unexplained that follows your cursor is alarming rather than helpful. */
    '.bar{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;pointer-events:auto;overflow:hidden;',
    'background:linear-gradient(150deg,rgba(52,32,74,.97),rgba(37,22,52,.97));',
    'border:1px solid rgba(255,255,255,.11);color:#f4ecfa;',
    'font:13px/1.5 "Nunito",system-ui,-apple-system,sans-serif;',
    '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);',
    'padding:15px 17px 14px;border-radius:16px;box-shadow:0 18px 48px rgba(18,7,30,.5);max-width:min(560px,92vw);}',
    '.bar::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,#b06fd6,#df6ca9);}',
    '.head{display:flex;align-items:center;gap:8px;margin-bottom:9px;}',
    '.dot{flex:none;width:7px;height:7px;border-radius:50%;background:#49c879;box-shadow:0 0 0 4px rgba(73,200,121,.16);}',
    '.dot.warn{background:#f0b866;box-shadow:0 0 0 4px rgba(240,184,102,.16);}',
    '.brand{font:800 10.5px "Quicksand",system-ui,sans-serif;letter-spacing:.11em;text-transform:uppercase;color:#f2dcfb;}',
    '.sep{color:#6f5a86;}',
    '.mode{font:800 10.5px "Quicksand",system-ui,sans-serif;letter-spacing:.11em;text-transform:uppercase;color:#cba6f0;}',
    '.tally{margin-left:auto;flex:none;font:800 11px "Quicksand",system-ui,sans-serif;padding:3px 9px;border-radius:999px;background:rgba(224,122,174,.17);border:1px solid rgba(224,122,174,.32);color:#f6bdda;}',
    '.t{font:800 14.5px "Quicksand",system-ui,sans-serif;color:#fff;margin-bottom:3px;}',
    '.s{font:11px ui-monospace,SFMono-Regular,monospace;color:#cba6f0;word-break:break-all;margin:6px 0 2px;padding:6px 8px;border-radius:7px;background:rgba(176,111,214,.12);}',
    '.n{font-size:11.5px;color:#c2aed4;}',
    '.warn{color:#f0b866;}',
    '.keys{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:9px;font-size:11px;color:#9c88b0;}',
    '.keys b{color:#eadcf6;font:700 10.5px system-ui,sans-serif;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:2px 6px;}',
    '.row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}',
    'button{all:unset;cursor:pointer;font:800 12px "Quicksand",system-ui,sans-serif;padding:9px 14px;border-radius:10px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);color:#f4ecfa;}',
    'button.keep{background:linear-gradient(135deg,#b861d6,#df6ca9);border-color:rgba(255,255,255,.2);box-shadow:0 8px 20px rgba(129,57,164,.3);}',
    'button:hover{filter:brightness(1.12);}',
  ].join('');
  root.appendChild(style);

  const box = document.createElement('div');
  box.className = 'box zap';
  box.style.display = 'none';
  root.appendChild(box);

  const bar = document.createElement('div');
  bar.className = 'bar';
  root.appendChild(bar);

  (document.body || document.documentElement).appendChild(ui);

  let current = null;
  /* How many things have gone this run, and a sequence number so a slow reply
     for an earlier zap cannot repaint the panel belonging to a later one -- you
     can click three things faster than three round-trips finish. */
  let zapCount = 0;
  let latestSeq = 0;

  /* The last size written, so an unchanged box costs one transform write rather
     than four style writes the browser has to lay out again. */
  let boxW = -1;
  let boxH = -1;
  function frame(el) {
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0)';
    if (r.width !== boxW) { boxW = r.width; box.style.width = r.width + 'px'; }
    if (r.height !== boxH) { boxH = r.height; box.style.height = r.height + 'px'; }
  }

  function tooBig(el) {
    const r = el.getBoundingClientRect();
    const vw = Math.max(1, Number(document.documentElement.clientWidth) || Number(innerWidth) || 1);
    const vh = Math.max(1, Number(document.documentElement.clientHeight) || Number(innerHeight) || 1);
    const visibleWidth = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const visibleHeight = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return (visibleWidth * visibleHeight) > (vw * vh * HUGE);
  }

  function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function say(node) { bar.textContent = ''; bar.appendChild(node); }

  function keyHints() {
    const k = el('div', 'keys');
    k.appendChild(el('b', null, 'Esc'));
    k.appendChild(document.createTextNode(' cancel  '));
    k.appendChild(el('b', null, '↑↓'));
    k.appendChild(document.createTextNode(' or scroll to widen  '));
    k.appendChild(el('b', null, 'Ctrl+Z'));
    k.appendChild(document.createTextNode(' undo'));
    return k;
  }

  /* One header for both states, so the panel reads as one thing changing rather
     than two different boxes. The tally only appears once there is something to
     count. */
  function panelHead(mode, warn) {
    const head = el('div', 'head');
    head.appendChild(el('span', 'dot' + (warn ? ' warn' : '')));
    head.appendChild(el('span', 'brand', 'WardenOne'));
    head.appendChild(el('span', 'sep', '·'));
    head.appendChild(el('span', 'mode', mode));
    if (zapCount > 0) head.appendChild(el('span', 'tally', zapCount + ' hidden'));
    return head;
  }

  function hintPanel() {
    const wrap = el('div');
    wrap.appendChild(panelHead('Element Zapper'));
    wrap.appendChild(el('div', 't', 'Point at what you want gone.'));
    wrap.appendChild(el('div', 'n', 'Click anything you do not want to see. Each one is hidden and remembered for ' + HOST + '. Keep going for as long as you like, then press Done.'));
    wrap.appendChild(keyHints());
    /* A way out that does not require knowing about Esc. */
    const row = el('div', 'row');
    const cancel = el('button', null, 'Cancel');
    cancel.addEventListener('click', stop);
    row.appendChild(cancel);
    wrap.appendChild(row);
    return wrap;
  }

  say(hintPanel());

  /* ---- picking ----------------------------------------------------------- */

  /* A mouse reports far more often than the screen redraws -- 1000Hz on plenty of
     hardware against 60 or 120 frames. Doing the work per event meant hundreds of
     elementFromPoint and getBoundingClientRect calls per frame, each one forcing
     layout, for one picture. The position is remembered and the work happens once
     per frame instead. */
  let pointerX = 0;
  let pointerY = 0;
  let moveRaf = 0;
  function trackPointer() {
    moveRaf = 0;
    const t = document.elementFromPoint(pointerX, pointerY);
    if (!t || t === ui || t === document.documentElement || t === document.body) { frame(null); current = null; return; }
    current = t;
    frame(t);
  }
  function onMove(e) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (!moveRaf) moveRaf = requestAnimationFrame(trackPointer);
  }

  /* `rule` is the selector that was written, when there is one. The review panel
     used to be a separate mode whose whole job was answering two questions --
     how much does this rule catch, and will it survive a redesign. Both are worth
     knowing whether or not you asked to review, so they are said here instead of
     behind a second tool. */
  function zapPanel(message, failed, rule) {
    const wrap = el('div');
    wrap.appendChild(panelHead('Element Zapper', failed));
    /* The heading is the count, because the count is the thing that changes
       while you keep going. */
    wrap.appendChild(el('div', 't' + (failed ? ' warn' : ''),
      failed ? 'Hidden for now, but not saved'
        : (zapCount === 1 ? 'One thing hidden' : zapCount + ' things hidden')));
    wrap.appendChild(el('div', 'n', message || 'Hidden and saved for this site.'));
    if (rule) {
      wrap.appendChild(el('div', 's', rule));
      const n = matchCount(rule);
      if (n > 1) {
        wrap.appendChild(el('div', 'n warn',
          'This rule matches ' + n + ' things on this page — that may be more than you meant.'));
      }
      if (isFragile(rule)) {
        wrap.appendChild(el('div', 'n warn',
          'It is described by its position, so it may stop working when the site changes.'));
      }
    }
    /* The tool is still live. Saying so is the whole difference between this and
       a confirmation you have to dismiss before carrying on. */
    wrap.appendChild(el('div', 'n', 'Still zapping — click anything else to hide it too, then press Done.'));
    wrap.appendChild(keyHints());
    const row = el('div', 'row');
    const done = el('button', 'keep', 'Done');
    done.addEventListener('click', stop);
    row.appendChild(done);
    if (zapCount > 0) {
      const undo = el('button', null, 'Undo last');
      undo.addEventListener('click', () => {
        if (!undoOne()) return;
        say(zapCount ? zapPanel('Put that one back.', false, null) : hintPanel());
      });
      row.appendChild(undo);
    }
    wrap.appendChild(row);
    return wrap;
  }

  function selectTarget(t) {
    zap(t);
    frame(null);
    current = null;
    zapCount++;

    const seq = ++latestSeq;
    const sel = buildSelector(t);
    lastSaved.push(sel);
    const undoEntry = registerZapperUndo(t, sel);

    /* Only the newest zap owns the panel. An earlier save answering late would
       otherwise replace "3 hidden" with its own one-item confirmation. */
    const show = (message, failed, rule) => {
      if (seq !== latestSeq || !ui.isConnected) return;
      say(zapPanel(message, failed, rule));
    };

    show('Saving this for ' + HOST + '…', false, null);
    let answered = false;
    try {
      chrome.runtime.sendMessage({ kind: 'hidden-add', hostname: HOST, selector: sel }, (res) => {
        answered = true;
        finishZapperSave(undoEntry);
        const runtimeError = chrome.runtime.lastError;
        if (res && res.ok && !runtimeError) {
          show('Saved for this site. It will stay gone after a reload.', false, sel);
          return;
        }
        const reason = (res && res.error) || (runtimeError && runtimeError.message) || 'WardenOne could not save the rule.';
        show(reason + ' It is hidden only until this page reloads.', true, sel);
      });
    } catch (err) {
      answered = true;
      finishZapperSave(undoEntry);
      show(String((err && err.message) || err || 'WardenOne could not save the rule.')
        + ' It is hidden only until this page reloads.', true, sel);
    }
    setTimeout(() => {
      if (answered) return;
      finishZapperSave(undoEntry);
      show('WardenOne did not receive a save response. It is hidden only until this page reloads.', true, sel);
    }, 2500);
  }

  /* Undo one zap and stay where you are. Three stacks are pushed together for
     every zap -- the page attribute, the saved selector, and the page-lifetime
     entry Ctrl+Z uses after the overlay has gone -- so they are popped together
     too, or the next undo retracts a rule for something still on screen. */
  function undoOne() {
    if (!undoLatestZapper()) return false;
    zapped.pop();
    lastSaved.pop();
    zapCount = Math.max(0, zapCount - 1);
    latestSeq++;
    return true;
  }

  /* Our own controls live in a shadow root inside `ui`. A capture listener sees
     their clicks before their own handlers do, so they have to be let through or
     Done, Undo and Cancel look clickable while doing nothing. */
  function ours(e) {
    if (e.target === ui) return true;
    try {
      if (typeof e.composedPath === 'function' && e.composedPath().indexOf(ui) >= 0) return true;
    } catch (_) {}
    return false;
  }

  /* Cancelling the click is too late on a real page. A video player starts
     playing on pointerdown, a link can be followed from mouseup, and YouTube does
     both -- so by the time the click arrives to be cancelled, the video is
     already running. The whole gesture is swallowed instead of just its last
     event.

     stopImmediatePropagation, not stopPropagation: the latter stops the event
     travelling further but still runs every other listener already attached to
     the same node in the same phase. */
  const SWALLOWED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'dblclick'];
  function swallow(e) {
    if (ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const t = current || document.elementFromPoint(e.clientX, e.clientY);
    if (!t || t === document.body || t === document.documentElement) return;

    if (tooBig(t) && !t.__woConfirmedBig) {
      t.__woConfirmedBig = true;
      const wrap = el('div');
      wrap.appendChild(el('div', 't warn', 'That covers most of the page'));
      wrap.appendChild(el('div', 'n', 'Hiding it will probably look like the site is broken. Click it again if you meant it, or pick something smaller.'));
      const row = el('div', 'row');
      const hide = el('button', 'keep', 'Hide it anyway');
      const cancel = el('button', null, 'Cancel');
      hide.addEventListener('click', () => selectTarget(t));
      cancel.addEventListener('click', stop);
      row.appendChild(hide); row.appendChild(cancel);
      wrap.appendChild(row);
      say(wrap);
      return;
    }
    selectTarget(t);
  }

  /* Widen and narrow. The first click usually lands on a child of the thing the
     reader means -- the close button inside the popup rather than the popup --
     so both the keyboard and the wheel walk the tree. */
  function widen() {
    if (current && current.parentElement && current.parentElement !== document.body) {
      current = current.parentElement; frame(current);
    }
  }
  function narrow() {
    if (current && current.firstElementChild) { current = current.firstElementChild; frame(current); }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      /* Leaves, keeps what you hid. Undoing everything on the way out made the
         obvious exit the destructive one -- you press Escape to stop pointing at
         things, not to get the adverts back. Ctrl+Z is the undo. */
      stop();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (undoTargetIsEditable(e.target) || !undoOne()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      /* Undo puts one thing back; it does not close the tool. Escape does that. */
      say(zapCount ? zapPanel('Put that one back.', false, null) : hintPanel());
      return;
    }
    if (e.key === 'ArrowUp') { widen(); e.preventDefault(); }
    if (e.key === 'ArrowDown') { narrow(); e.preventDefault(); }
  }

  function onWheel(e) {
    if (!current) return;
    e.preventDefault();
    if (e.deltaY < 0) widen(); else narrow();
  }

  function stop() {
    if (moveRaf) { try { cancelAnimationFrame(moveRaf); } catch (_) {} moveRaf = 0; }
    try { window.removeEventListener('mousemove', onMove, true); } catch (_) {}
    try { window.removeEventListener('click', onClick, true); } catch (_) {}
    try { window.removeEventListener('keydown', onKey, true); } catch (_) {}
    try { window.removeEventListener('wheel', onWheel, true); } catch (_) {}
    SWALLOWED.forEach((type) => {
      try { window.removeEventListener(type, swallow, true); } catch (_) {}
    });
    try { ui.remove(); } catch (_) {}
    window.__wardenOnePickerActive = false;
  }

  /* On window rather than document. Capture runs outermost-first, and window is
     the outermost node there is -- so a page that registered its own capture
     listener on document before the zapper was injected no longer gets the event
     first. On YouTube it did, which is why clicking a video played it. */
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  SWALLOWED.forEach((type) => {
    window.addEventListener(type, swallow, { capture: true, passive: false });
  });
}());

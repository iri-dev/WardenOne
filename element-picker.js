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
  /* What to call this site in a sentence. A page with no hostname -- a local
     file, an about: page -- otherwise produced "remembered for ." mid-sentence. */
  const HOST_LABEL = HOST || 'this page';
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
  const MEANINGFUL_ATTRS = ['data-testid', 'data-test-id', 'data-qa', 'data-a-target',
    'aria-label', 'role', 'name', 'data-ad-slot', 'alt', 'title'];

  /* href is the strongest identifier a list item has: it says WHICH thing this
     card is about, and it survives the list being reordered, which nothing about
     the element's position does. Kept separate from the list above because its
     value needs its own bounds -- a URL is longer and has more punctuation than
     a test id, and one carrying a character the worker's selector validator
     rejects would produce a rule that is silently never saved. */
  function stableHref(el) {
    const raw = String(el.getAttribute('href') || '').trim();
    if (!raw || raw.length > 120) return '';
    if (/^(#|javascript:|data:|blob:)/i.test(raw)) return '';
    if (/[{}<>;@\\"']/.test(raw)) return '';
    return raw;
  }

  function cssEscape(value) {
    try { return CSS.escape(value); } catch (_) { return String(value).replace(/[^\w-]/g, ''); }
  }

  /* Whether a selector actually names this element or merely describes its
     shape. "div" and "img.avatar" describe a shape every card on the page
     shares; "#nav" and "a[href=/alice]" name one thing. Only the second kind is
     worth anchoring to. */
  function identifies(sel, tag) {
    return !!sel && sel !== tag && (sel.indexOf('#') === 0 || sel.indexOf('[') >= 0);
  }

  /* The fix for a list that reorders. Find the nearest ancestor that NAMES
     itself, then describe the target inside it -- "[data-who=bob] .avatar"
     rather than "div:nth-child(2) > img". Both are unique on the page as it
     stands; only the first is still about the same thing after the page reorders
     itself, which a Twitch sidebar does on every load. Position was the previous
     answer here and it silently retargeted: a rule saved against slot two came
     back after a restart hiding whoever was in slot two now. */
  function anchoredSelector(el) {
    const own = ownSelector(el);
    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && node !== document.documentElement && depth < MAX_DEPTH) {
      const anchor = ownSelector(node);
      if (identifies(anchor, node.tagName.toLowerCase())) {
        const candidate = anchor + ' ' + own;
        if (matchCount(candidate) === 1) return candidate;
      }
      node = node.parentElement;
      depth++;
    }
    return '';
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

    const href = stableHref(el);
    if (href) return tag + '[href="' + href + '"]';

    /* Any data-* attribute whose value looks like a name rather than a number or
       a build hash. An allowlist of the seven attribute names we happened to
       think of does not generalise -- sites label their list items with
       data-who, data-user, data-channel, data-item and a hundred other things,
       and every one of those is a better anchor than the element's position.
       Numeric values are refused because data-index="2" is the same fragility as
       nth-child wearing a different hat. */
    const attrs = el.attributes;
    for (let i = 0; attrs && i < attrs.length; i++) {
      const name = String(attrs[i].name || '');
      if (name.indexOf('data-') !== 0) continue;
      /* Never anchor to our own marker: it is on the element only because we
         just hid it, so a rule built from it would match nothing on reload. */
      if (name.indexOf('data-wardenone') === 0) continue;
      if (MEANINGFUL_ATTRS.indexOf(name) >= 0) continue;
      const v = String(attrs[i].value || '').trim();
      if (!v || v.length > 60 || /^\d+$/.test(v) || looksGenerated(v)) continue;
      if (!/^[\w][\w\s.:-]*$/.test(v)) continue;
      return tag + '[' + name + '="' + v + '"]';
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
    /* Anchored to something that names itself, before anything positional. */
    const anchored = anchoredSelector(el);
    if (anchored) return anchored;

    const positional = positionalSelector(el);
    if (positional && matchCount(positional) === 1) return positional;
    /* Neither is unique. Prefer whichever catches less. */
    if (positional && matchCount(positional) < matchCount(sel)) return positional;
    return sel;
  }

  function isFragile(sel) {
    return sel.indexOf(':nth-child(') >= 0 || /(^|\s|>)(div|span|li|section|p)$/.test(sel.trim());
  }

  /* A positional rule inside a list of near-identical siblings is a different and
     worse problem from a positional rule in general. A fixed header at
     :nth-child(2) stays where it is; the second card in a feed does not. When the
     list reorders, the rule keeps pointing at the SLOT, so it comes back hiding
     whoever moved into it -- which looks like the zap was forgotten, and is
     actually the zap landing on somebody else. Worth saying in those words. */
  function looksLikeListItem(el) {
    try {
      const parent = el.parentElement && el.parentElement.parentElement;
      if (!parent || parent.children.length < 3) return false;
      const shape = (node) => node.tagName + '|' + (node.getAttribute('class') || '');
      const mine = shape(el.parentElement);
      let alike = 0;
      for (const sib of parent.children) if (shape(sib) === mine) alike++;
      return alike >= 3;
    } catch (_) { return false; }
  }

  /* ---- the overlay ------------------------------------------------------- */

  const ui = document.createElement('div');
  ui.id = 'wo-picker-root';
  const shadow = ui.attachShadow ? ui.attachShadow({ mode: 'closed' }) : null;
  const root = shadow || ui;
  ui.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';

  const style = document.createElement('style');
  style.textContent = [
    /* Positioned by transform, not by left/top: `transition:all` over
       left/top/width/height ran four layout-driven transitions on every mouse
       move, which is why the highlight crawled. Transitioning only transform
       was still wrong -- the box slid into place over about four frames while
       its width and height snapped in one, so it trailed the pointer AND was
       briefly the new element's size at the old element's position. Nothing is
       transitioned now: the outline is welded to whatever is under the cursor,
       which is what an inspector highlight is for. */
    '.box{position:fixed;left:0;top:0;border:2px solid #9d54c9;background:rgba(157,84,201,.14);pointer-events:none;border-radius:4px;will-change:transform;contain:strict;}',
    '.box.zap{border-color:#df6ca9;background:rgba(223,108,169,.15);}',
    /* The same card the engine's own toasts use: pale lavender, a plum rail down
       the left, Quicksand for the line that matters. It was a dark panel with an
       uppercase two-part eyebrow and a green status dot, which is the language of
       the extension's OWN pages -- wrong here, because this appears on somebody
       else's page exactly as a toast does, and the status dot in particular was
       reporting nothing. Matching the toast means the reader has seen this shape
       before and does not have to work out whose it is. */
    '.bar{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;pointer-events:auto;',
    'background:linear-gradient(135deg,#faf2fe,#f4e9fb);border-left:4px solid #9d54c9;',
    'border-radius:14px;padding:13px 15px;box-shadow:0 8px 28px rgba(120,55,160,.26);',
    'color:#3d2a52;font:13px/1.45 "Nunito",-apple-system,"Segoe UI",system-ui,sans-serif;',
    'max-width:min(520px,92vw);}',
    '.t{font:700 13.5px "Quicksand","Nunito",system-ui,sans-serif;color:#3d2a52;margin-bottom:2px;}',
    '.t.warn{color:#a8305f;}',
    '.n{font-size:12px;color:#7a5f93;line-height:1.45;}',
    '.n.warn{color:#a8305f;}',
    '.s{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#6b4f85;word-break:break-all;',
    'margin:6px 0 0;padding:5px 7px;border-radius:7px;background:rgba(157,84,201,.09);}',
    /* The engine's own toast footer: a hairline, then small muted text. */
    '.keys{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:9px;padding-top:7px;',
    'border-top:1px solid rgba(157,84,201,.16);font-size:10px;color:#a08db3;}',
    '.keys b{font:600 10px "Nunito",system-ui,sans-serif;color:#5d3f78;background:#f2e9f9;',
    'border:1px solid #e0cff0;border-radius:6px;padding:1px 5px;}',
    '.keys .who{margin-left:auto;color:#bda9cf;}',
    '.row{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap;}',
    'button{all:unset;box-sizing:border-box;cursor:pointer;font:600 11.5px "Quicksand","Nunito",system-ui,sans-serif;',
    'padding:6px 11px;border-radius:8px;color:#8f77a6;border:1px solid transparent;}',
    'button:hover{color:#5d3f78;background:#f2e9f9;border-color:#e0cff0;}',
    'button.keep{color:#5d3f78;background:#f2e9f9;border-color:#e0cff0;}',
    'button.keep:hover{background:#eadcf6;border-color:#d7bfec;}',
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

  /* The last rectangle written. The pointer moves many times inside one element,
     so most frames ask for a box that is already exactly where it needs to be --
     those now cost a comparison rather than style writes the browser has to lay
     out and raster again. */
  let boxX = -1;
  let boxY = -1;
  let boxW = -1;
  let boxH = -1;
  let boxOn = false;
  function frame(el) {
    if (!el) {
      if (boxOn) { boxOn = false; box.style.display = 'none'; }
      return;
    }
    const r = el.getBoundingClientRect();
    if (!boxOn) { boxOn = true; box.style.display = 'block'; }
    if (r.left !== boxX || r.top !== boxY) {
      boxX = r.left; boxY = r.top;
      box.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0)';
    }
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
    k.appendChild(document.createTextNode('cancel'));
    k.appendChild(el('b', null, '↑↓'));
    k.appendChild(document.createTextNode('widen'));
    k.appendChild(el('b', null, 'Ctrl+Z'));
    k.appendChild(document.createTextNode('undo'));
    /* Whose this is, said once and quietly, on the same hairline footer the
       engine's toasts use for their own small print. A branded header block with
       a status light was too loud for something that sits over a page you are
       trying to read -- and the light reported nothing. */
    k.appendChild(el('span', 'who', 'WardenOne'));
    return k;
  }

  function hintPanel() {
    const wrap = el('div');
    wrap.appendChild(el('div', 't', 'Point at what you want gone.'));
    wrap.appendChild(el('div', 'n', 'Click anything you do not want to see. Each one is hidden and remembered for ' + HOST_LABEL + '. Keep going for as long as you like, then press Done.'));
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
  /* The pointer can hold still while the page moves under it -- a scroll, a lazy
     image landing, a sticky bar arriving. Without this the outline sits where the
     element used to be until you jog the mouse. Capture, because the scroll that
     matters is often an inner container rather than the window; passive, because
     this only ever reads. */
  function onScroll() {
    if (!moveRaf) moveRaf = requestAnimationFrame(trackPointer);
  }

  /* `rule` is the selector that was written, when there is one. The review panel
     used to be a separate mode whose whole job was answering two questions --
     how much does this rule catch, and will it survive a redesign. Both are worth
     knowing whether or not you asked to review, so they are said here instead of
     behind a second tool. */
  function zapPanel(message, failed, rule) {
    const wrap = el('div');
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
        wrap.appendChild(el('div', 'n warn', lastWasListItem
          ? 'Nothing on this one identifies it, so the rule points at its POSITION in the list. If the list reorders, this will hide whatever moves into that slot instead.'
          : 'It is described by its position, so it may stop working when the site changes.'));
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

  /* Set as each rule is built, so the panel can say which kind of positional
     rule it just wrote rather than giving the same warning for both. */
  let lastWasListItem = false;

  function selectTarget(t) {
    lastWasListItem = looksLikeListItem(t);
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

    show('Saving this for ' + HOST_LABEL + '…', false, null);
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
    try { window.removeEventListener('scroll', onScroll, true); } catch (_) {}
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
  /* Take the caret off any text field the page had focused. Undo deliberately
     stands aside for inputs so it cannot eat someone's half-typed message, and
     on a site that keeps the caret in a chat box that guard swallowed every
     Ctrl+Z: the first press landed while the body still had focus and worked,
     and every one after it went to the chat box and did nothing. Nothing here
     types, so the tool takes the caret for as long as it is open. */
  try {
    if (undoTargetIsEditable(document.activeElement)) document.activeElement.blur();
  } catch (_) {}

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  SWALLOWED.forEach((type) => {
    window.addEventListener(type, swallow, { capture: true, passive: false });
  });
}());

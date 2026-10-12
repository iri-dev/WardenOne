/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
(function () {
  'use strict';

  if (window === window.top) return;

  const selector = 'img[src],img[srcset],picture source[srcset],base';
  const possibleGrabberUrl = /ip-?logger|grabify|%|[^\x00-\x7f]/i;
  const possibleOrSplit = /ip-?logger|grabify|[%\t\n\r]|[^\x00-\x7f]/i;
  const parserRemoved = /[\t\n\r]/g;
  const warned = new Set();
  const hostCache = new Map();
  let observer = null;
  let baseObserver = null;
  let watchedBases = [];
  let baseSeen = false;
  let settleListening = false;
  let activeBase = document.baseURI || location.href;
  let baseHint = possibleGrabberUrl.test(activeBase);
  let frameSite = '';

  /* URL resolution cannot add a logger marker unless it comes from the value or base. The
     parser deletes tabs and newlines, so a word split by them is tested joined. Encoded and
     non-ASCII values still take the full parser path. */
  function mayBeGrabber(value) {
    return possibleOrSplit.test(value)
      && (possibleGrabberUrl.test(value) || possibleGrabberUrl.test(value.replace(parserRemoved, '')));
  }

  function candidateHost(value) {
    if (!value) return '';
    const raw = String(value);
    if (!baseHint && !mayBeGrabber(raw)) return '';
    const key = activeBase + '\n' + raw;
    if (hostCache.has(key)) return hostCache.get(key);
    let candidate = '';
    try {
      const url = new URL(raw, activeBase);
      const host = url.hostname.toLowerCase();
      if (/^https?:$/.test(url.protocol) && host && host.includes('.')
          && (!frameSite || typeof siteIdentity !== 'function' || siteIdentity(host) !== frameSite)) {
        if (/(^|[.-])(iplogger|ip-logger|grabify)([.-]|$)/i.test(host)
            || /^\/(?:api\/)?(?:iplogger|ip-logger|grabify)\/(?=[a-z0-9_-]*\d)[a-z0-9_-]{8,}(?:[/.]|$)/i.test(url.pathname)) {
          candidate = host;
        }
      }
    } catch (_) {}
    if (hostCache.size >= 64) hostCache.clear();
    hostCache.set(key, candidate);
    return candidate;
  }

  function inspectUrl(value, selected) {
    const host = candidateHost(value);
    if (!host || warned.has(host) || warned.size >= 8) return;
    warned.add(host);
    try {
      chrome.runtime.sendMessage({ kind: 'rg-block', type: 'detected_grabber_image_candidate',
        detail: selected ? { matched: host, quiet: true, selected: true }
          : { matched: host, quiet: true } }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  function inspectSelected(image) {
    if (image && image.tagName === 'IMG' && image.currentSrc) inspectUrl(image.currentSrc, true);
  }

  function listenForSelection(value, picture) {
    if (settleListening || (!value && !picture)) return;
    if (!picture && !baseHint && !mayBeGrabber(String(value))) return;
    document.addEventListener('load', onImageSettled, true);
    document.addEventListener('error', onImageSettled, true);
    settleListening = true;
  }

  function inspectImage(node) {
    if (!node || !node.getAttribute) return;
    const tag = node.tagName;
    if (tag === 'IMG') {
      const srcset = node.getAttribute('srcset');
      const picture = node.parentElement && node.parentElement.tagName === 'PICTURE';
      if (srcset || picture) {
        listenForSelection(srcset, picture);
        if (srcset) listenForSelection(node.getAttribute('src'));
        inspectSelected(node);
      } else inspectUrl(node.getAttribute('src'));
    } else if (tag === 'SOURCE' && node.parentElement && node.parentElement.tagName === 'PICTURE') {
      listenForSelection(node.getAttribute('srcset'));
      inspectSelected(node.parentElement.querySelector('img'));
    } else if (tag === 'BASE') baseSeen = true;
  }

  function onImageSettled(event) {
    const node = event.target;
    if (!node || node.tagName !== 'IMG') return;
    const selected = node.currentSrc;
    if (!selected || !possibleGrabberUrl.test(selected)) return;
    if (node.getAttribute('srcset') || (node.parentElement && node.parentElement.tagName === 'PICTURE')) {
      inspectUrl(selected, true);
    }
  }

  function inspectTree(root) {
    if (!root || !root.querySelectorAll) return;
    try { root.querySelectorAll(selector).forEach(inspectImage); } catch (_) {}
  }

  /* A page that builds itself appends a container and then its children, each as its own
     record. A node with an added ancestor is inside that ancestor's scan, so only the outermost
     ones are scanned. `clear` remembers ancestors already shown to have none above them. */
  function inspectAddedTrees(nodes) {
    if (nodes.length === 1) { inspectTree(nodes[0]); return; }
    const added = new Set(nodes);
    const clear = new Set();
    for (const node of nodes) {
      const walked = [];
      let covered = false;
      for (let up = node.parentNode; up && !clear.has(up); up = up.parentNode) {
        if (added.has(up)) { covered = true; break; }
        walked.push(up);
      }
      if (covered) continue;
      for (const up of walked) clear.add(up);
      inspectTree(node);
    }
  }

  /* A base change can make an ordinary relative srcset select a logger URL. */
  function checkBase() {
    const next = document.baseURI || location.href;
    if (next === activeBase) return;
    activeBase = next;
    baseHint = possibleGrabberUrl.test(next);
    inspectTree(document);
  }

  function watchBase() {
    baseSeen = false;
    let bases;
    try { bases = Array.from(document.querySelectorAll('base')); } catch (_) { return; }
    if (bases.length === watchedBases.length && bases.every((base, i) => base === watchedBases[i])) return;
    if (baseObserver) baseObserver.disconnect();
    watchedBases = bases;
    if (!bases.length) return;
    try {
      if (!baseObserver) baseObserver = new MutationObserver(checkBase);
      for (const base of bases) baseObserver.observe(base, { attributes: true, attributeFilter: ['href'] });
    } catch (_) { watchedBases = []; }
  }

  function onMutations(records) {
    checkBase();
    let lastTarget = null;
    let addedTrees = null;
    for (const record of records) {
      if (record.type === 'attributes') {
        /* src and srcset set back to back arrive as two records for one image. */
        if (record.target !== lastTarget) inspectImage(record.target);
        lastTarget = record.target;
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        inspectImage(node);
        if (node.firstElementChild) (addedTrees || (addedTrees = [])).push(node);
      }
    }
    if (addedTrees) inspectAddedTrees(addedTrees);
    /* Re-list <base> elements only when one arrived or a watched one left the document,
       not on every structural change. */
    if (baseSeen || watchedBases.some((base) => base.isConnected === false)) watchBase();
  }

  function sync() {
    let state = null;
    try { state = window.__wardenOneFrameGrabberConfig && window.__wardenOneFrameGrabberConfig(); } catch (_) {}
    if (!state || !state.enabled) {
      if (observer) observer.disconnect();
      if (baseObserver) baseObserver.disconnect();
      watchedBases = [];
      if (settleListening) {
        document.removeEventListener('load', onImageSettled, true);
        document.removeEventListener('error', onImageSettled, true);
      }
      observer = null;
      settleListening = false;
      hostCache.clear();
      return;
    }
    const nextSite = typeof state.site === 'string' ? state.site : '';
    if (frameSite !== nextSite) hostCache.clear();
    frameSite = nextSite;
    if (observer) return;
    activeBase = document.baseURI || location.href;
    baseHint = possibleGrabberUrl.test(activeBase);
    inspectTree(document);
    watchBase();
    observer = new MutationObserver(onMutations);
    observer.observe(document, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'srcset'] });
  }

  document.addEventListener('wo-bridge-config-ready', sync);
  sync();
})();

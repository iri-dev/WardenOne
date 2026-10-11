/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
(function () {
  'use strict';

  if (window === window.top) return;

  const selector = 'img[src],img[srcset],picture source[srcset]';
  const warned = new Set();
  let observer = null;
  let frameSite = '';

  function candidateHost(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value), document.baseURI || location.href);
      const host = url.hostname.toLowerCase();
      if (!/^https?:$/.test(url.protocol) || !host || !host.includes('.')) return '';
      if (frameSite && typeof siteIdentity === 'function' && siteIdentity(host) === frameSite) return '';
      if (/(^|[.-])(iplogger|ip-logger|grabify)([.-]|$)/i.test(host)) return host;
      return /^\/(?:api\/)?(?:iplogger|ip-logger|grabify)\/(?=[a-z0-9_-]*\d)[a-z0-9_-]{8,}(?:[/.]|$)/i.test(url.pathname)
        ? host : '';
    } catch (_) { return ''; }
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

  function inspectImage(node) {
    if (!node || !node.getAttribute) return;
    if (node.tagName === 'IMG') {
      if (node.getAttribute('srcset') || (node.parentElement && node.parentElement.tagName === 'PICTURE')) {
        inspectSelected(node);
      } else inspectUrl(node.getAttribute('src'));
    }
    if (node.tagName === 'SOURCE' && node.parentElement && node.parentElement.tagName === 'PICTURE') {
      inspectSelected(node.parentElement.querySelector('img'));
    }
  }

  function onImageSettled(event) {
    const node = event.target;
    if (node && node.tagName === 'IMG' && (node.getAttribute('srcset')
        || (node.parentElement && node.parentElement.tagName === 'PICTURE'))) inspectSelected(node);
  }

  function inspectTree(root) {
    if (!root || !root.querySelectorAll) return;
    try { root.querySelectorAll(selector).forEach(inspectImage); } catch (_) {}
  }

  function onMutations(records) {
    for (const record of records) {
      if (record.type === 'attributes') {
        inspectImage(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        inspectImage(node);
        inspectTree(node);
      }
    }
  }

  function sync() {
    let state = null;
    try { state = window.__wardenOneFrameGrabberConfig && window.__wardenOneFrameGrabberConfig(); } catch (_) {}
    if (!state || !state.enabled) {
      if (observer) observer.disconnect();
      if (observer) {
        document.removeEventListener('load', onImageSettled, true);
        document.removeEventListener('error', onImageSettled, true);
      }
      observer = null;
      return;
    }
    frameSite = typeof state.site === 'string' ? state.site : '';
    if (observer) return;
    inspectTree(document);
    observer = new MutationObserver(onMutations);
    observer.observe(document, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'srcset'] });
    document.addEventListener('load', onImageSettled, true);
    document.addEventListener('error', onImageSettled, true);
  }

  document.addEventListener('wo-bridge-config-ready', sync);
  sync();
})();

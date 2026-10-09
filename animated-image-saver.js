/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';
  if (globalThis.__woAnimatedImageSaver) return;
  globalThis.__woAnimatedImageSaver = true;

  const GIF_URL = /(?:\.gif(?:[?#]|$)|[?&](?:format|fm)=gif(?:[&#]|$))/i;
  const GIPHY_MEDIA = /^https:\/\/media\d*\.giphy\.com\/media\//i;
  const MAX_IMAGE_PIXELS = 250000;
  const MAX_PAGE_PIXELS = 8000000;
  const VIEWPORT_MARGIN = 128;
  const frozen = new Map();
  const canvasImages = new WeakMap();
  let played = new WeakMap();
  let incompatible = new WeakMap();
  let pagePixels = 0;
  let enabled = false;
  let observer = null;
  let visibilityObserver = null;
  let refreshNumber = 0;

  function sourceKey(image) {
    return String(image.currentSrc || image.src || '') + '\n' + String(image.src || '');
  }

  function isAnimatedImage(image) {
    const displayed = String(image.currentSrc || image.src || '');
    if (GIF_URL.test(displayed)) return true;
    const fallback = String(image.src || '');
    if (!GIPHY_MEDIA.test(displayed) || !GIPHY_MEDIA.test(fallback)) return false;
    try {
      const selected = new URL(displayed);
      const gif = new URL(fallback);
      /* GIPHY serves the same animation as WebP through <picture>, with GIF as fallback. */
      return selected.origin === gif.origin && gif.pathname.endsWith('.gif') &&
        selected.pathname === gif.pathname.slice(0, -4) + '.webp';
    } catch (_) { return false; }
  }

  function restore(image, play, skipSource) {
    const state = frozen.get(image);
    if (!state) return;
    frozen.delete(image);
    pagePixels -= state.pixels;
    if (play) played.set(image, state.key);
    if (skipSource) incompatible.set(image, state.key);
    if (visibilityObserver) visibilityObserver.unobserve(state.canvas);
    state.canvas.remove();
    if (image.style.getPropertyValue('display') === 'none' &&
        image.style.getPropertyPriority('display') === 'important') {
      if (state.display) image.style.setProperty('display', state.display, state.priority);
      else image.style.removeProperty('display');
    }
    if (enabled && visibilityObserver && image.isConnected) visibilityObserver.observe(image);
  }

  function nearViewport(bounds) {
    if (!visibilityObserver || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.left)) return true;
    return bounds.bottom >= -VIEWPORT_MARGIN && bounds.right >= -VIEWPORT_MARGIN &&
      bounds.top <= globalThis.innerHeight + VIEWPORT_MARGIN &&
      bounds.left <= globalThis.innerWidth + VIEWPORT_MARGIN;
  }

  function authoredSize(image, axis, measured) {
    const value = image.style.getPropertyValue(axis) || image.getAttribute(axis) || '';
    if (/^\d+(?:\.\d+)?$/.test(value)) return value + 'px';
    return value || measured + 'px';
  }

  function freeze(image) {
    if (!enabled || !image || image.tagName !== 'IMG' || !image.isConnected) return;
    const key = sourceKey(image);
    const previous = frozen.get(image);
    if (previous) {
      if (previous.key === key) return;
      restore(image, false, false);
    }
    if (played.get(image) === key || incompatible.get(image) === key) return;
    /* Sites stretch tiny GIF placeholders before assigning their real thumbnail. */
    if (!isAnimatedImage(image) || !image.complete || image.naturalWidth < 24 || image.naturalHeight < 24) return;
    const bounds = image.getBoundingClientRect();
    if (bounds.width < 24 || bounds.height < 24 || !nearViewport(bounds)) return;
    const naturalPixels = image.naturalWidth * image.naturalHeight;
    const density = Math.min(2, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight),
      Math.sqrt(MAX_IMAGE_PIXELS / naturalPixels),
      Math.sqrt(bounds.width * bounds.height * density * density / naturalPixels));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const pixels = width * height;
    if (pagePixels + pixels > MAX_PAGE_PIXELS) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    try {
      /* Cross-origin pixels can be displayed on a tainted canvas; never read them back. */
      context.drawImage(image, 0, 0, width, height);
    } catch (_) { return; }

    const style = getComputedStyle(image);
    for (const property of ['display', 'vertical-align', 'margin', 'border', 'border-radius',
      'padding', 'box-sizing', 'object-fit', 'object-position', 'max-width', 'max-height',
      'min-width', 'min-height', 'float', 'align-self', 'flex', 'grid-area']) {
      canvas.style.setProperty(property, style.getPropertyValue(property));
    }
    canvas.style.width = authoredSize(image, 'width', bounds.width);
    canvas.style.height = authoredSize(image, 'height', bounds.height);
    canvas.style.boxSizing = 'border-box';
    canvas.style.cursor = 'pointer';
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', image.alt ? 'Play animated image: ' + image.alt : 'Play animated image');
    canvas.title = 'Click to play animated image';
    canvas.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      restore(image, true, false);
    });
    canvas.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      restore(image, true, false);
    });
    const state = { canvas, key, pixels, display: image.style.getPropertyValue('display'),
      priority: image.style.getPropertyPriority('display') };
    try {
      image.after(canvas);
      if (!canvas.isConnected) return;
      image.style.setProperty('display', 'none', 'important');
    } catch (_) { canvas.remove(); return; }
    frozen.set(image, state);
    canvasImages.set(canvas, image);
    pagePixels += pixels;
    if (visibilityObserver) {
      visibilityObserver.unobserve(image);
      visibilityObserver.observe(canvas);
    }
  }

  function scan(root) {
    if (!root) return;
    const visit = (image) => {
      if (visibilityObserver && !frozen.has(image) && isAnimatedImage(image)) visibilityObserver.observe(image);
      freeze(image);
    };
    if (root.tagName === 'IMG') visit(root);
    if (typeof root.querySelectorAll === 'function') root.querySelectorAll('img').forEach(visit);
  }

  function changes(records) {
    let removed = false;
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        const image = target.tagName === 'IMG' ? target :
          target.tagName === 'SOURCE' && target.parentElement?.tagName === 'PICTURE' ?
            target.parentElement.querySelector('img') : null;
        if (!image) continue;
        if (frozen.has(image)) restore(image, false, false);
        if (target !== image) played.delete(image);
        scan(image);
      } else {
        record.addedNodes.forEach(scan);
        if (record.removedNodes?.length) removed = true;
      }
    }
    if (removed) {
      for (const [image, state] of frozen) {
        if (!image.isConnected || !state.canvas.isConnected || image.nextSibling !== state.canvas) {
          restore(image, false, image.isConnected);
        }
      }
    }
  }

  function onVisibility(entries) {
    for (const entry of entries) {
      if (entry.target.tagName === 'IMG') {
        if (entry.isIntersecting) freeze(entry.target);
      } else if (!entry.isIntersecting) {
        const image = canvasImages.get(entry.target);
        if (image && frozen.get(image)?.canvas === entry.target) restore(image, false, false);
      }
    }
  }

  function apply(state) {
    const next = !!state && state.images === true;
    if (next === enabled) return;
    enabled = next;
    if (enabled) {
      if (typeof IntersectionObserver === 'function') {
        visibilityObserver = new IntersectionObserver(onVisibility, { rootMargin: VIEWPORT_MARGIN + 'px' });
      }
      observer = new MutationObserver(changes);
      observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
      document.addEventListener('load', onLoad, true);
      scan(document);
      return;
    }
    if (observer) observer.disconnect();
    observer = null;
    if (visibilityObserver) visibilityObserver.disconnect();
    visibilityObserver = null;
    document.removeEventListener('load', onLoad, true);
    for (const image of Array.from(frozen.keys())) restore(image, false, false);
    played = new WeakMap();
    incompatible = new WeakMap();
  }

  function onLoad(event) { freeze(event.target); }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.kind !== 'resource-saver-update') return;
    refreshNumber++;
    apply(message);
  });
  chrome.runtime.sendMessage({ kind: 'resource-saver-state' }, (result) => {
    if (refreshNumber) return;
    apply(!chrome.runtime.lastError && result && result.ok === true ? result : null);
  });
})();

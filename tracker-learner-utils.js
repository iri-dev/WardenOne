/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOLearner = (() => {
  const pageSignals = Object.freeze({ 'known-tracker-host': 'page-claim', 'tracking-path': 'page-behavior',
    'tracking-params': 'page-behavior', 'beacon-api': 'page-behavior' });
  const sources = Object.freeze({ 'page-claim': 'Page claim', 'page-behavior': 'Page API/path observation',
    network: 'Browser network observation', 'curated-feed': 'Packaged tracker list',
    'curated-cname': 'Local CNAME mapping', 'fingerprint-feed': 'Known fingerprint library' });
  const signals = Object.freeze([...Object.keys(pageSignals), 'curated-feed', 'curated-cname', 'fingerprint-feed']);
  function pageEvidence(detail) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail) || typeof detail.signal !== 'string' || detail.signal.length > 40 || !Object.hasOwn(pageSignals, detail.signal)) return null;
    return { signal: detail.signal, source: pageSignals[detail.signal] };
  }
  function counts(value, allowed) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const key of allowed) {
      const count = value[key];
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[key] = Math.min(1000000, Math.floor(count));
    }
    return out;
  }
  function summary(value) {
    const evidence = counts(value, Object.keys(sources));
    const confirmed = ['curated-feed', 'curated-cname', 'fingerprint-feed'].some(key => evidence[key] > 0) && evidence.network > 0;
    return { confidence: confirmed ? 'corroborated' : evidence.network > 0 ? 'observed' : evidence['page-behavior'] > 0 ? 'inferred' : 'unverified',
      source: Object.keys(sources).filter(key => evidence[key] > 0).map(key => sources[key]).join(' + ') || 'No corroborated source recorded' };
  }
  function positions(salt, site, bits = 128) {
    let h = 0x811c9dc5;
    const text = String(salt) + '\n' + String(site);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    if (bits === 128) {
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    }
    const mask = bits - 1, a = h & mask;
    let b = (h >>> (bits === 32 ? 5 : 7)) & mask;
    if (b === a) b = (b + 1) & mask;
    return [a, b];
  }
  function validMarks(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
      || typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
  }
  function has(marks, salt, site) {
    const legacy = typeof marks === 'number';
    const [a, b] = positions(salt, site, legacy ? 32 : 128);
    if (legacy) return ((marks >>> a) & 1) === 1 && ((marks >>> b) & 1) === 1;
    if (!validMarks(marks)) return false;
    return [a, b].every(bit => ((parseInt(marks.slice((bit >>> 5) * 8, (bit >>> 5) * 8 + 8), 16) >>> (bit & 31)) & 1) === 1);
  }
  function add(marks, salt, site) {
    const legacy = typeof marks === 'number';
    const [a, b] = positions(salt, site, legacy ? 32 : 128);
    if (legacy) return ((marks >>> 0) | (1 << a) | (1 << b)) >>> 0;
    const text = validMarks(marks) ? marks : '0'.repeat(32);
    const words = Array.from({ length: 4 }, (_, i) => parseInt(text.slice(i * 8, i * 8 + 8), 16));
    for (const bit of [a, b]) words[bit >>> 5] = (words[bit >>> 5] | (1 << (bit & 31))) >>> 0;
    return words.map(word => word.toString(16).padStart(8, '0')).join('');
  }
  return Object.freeze({ pageSignals, sources, signals, pageEvidence, counts, summary, positions, validMarks, has, add });
})();
if (typeof module !== 'undefined') module.exports = WOLearner;

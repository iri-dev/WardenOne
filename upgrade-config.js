/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

function migrateStoredConfig(cfg, defaults) {
  let changed = false;
  if (cfg.__locationPrivacyV344Enabled !== true) {
    if (typeof cfg.blockGeolocation === 'undefined') cfg.blockGeolocation = true;
    cfg.__locationPrivacyV344Enabled = true;
    changed = true;
  }
  if (cfg.googleSearchResultCleanup === true && cfg.__searchCleanupSplitV352Enabled !== true) {
    if (typeof cfg.blockSearchAiAnswers === 'undefined') cfg.blockSearchAiAnswers = true;
    if (typeof cfg.blockSponsoredSearchResults === 'undefined') cfg.blockSponsoredSearchResults = true;
    cfg.googleSearchResultCleanup = false;
    cfg.__searchCleanupSplitV352Enabled = true;
    changed = true;
  }
  if (typeof cfg.stopAnimatedVideoPreviews === 'undefined' && typeof cfg.stopYouTubeVideoPreviews === 'boolean') {
    cfg.stopAnimatedVideoPreviews = cfg.stopYouTubeVideoPreviews;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(cfg, 'stopYouTubeVideoPreviews')) {
    delete cfg.stopYouTubeVideoPreviews;
    changed = true;
  }
  for (const field of Object.keys(cfg)) {
    if (/Key$/.test(field) && !Object.prototype.hasOwnProperty.call(defaults, field)) {
      delete cfg[field];
      changed = true;
    }
  }
  return changed ? cfg : false;
}

if (typeof module !== 'undefined') module.exports = { migrateStoredConfig };

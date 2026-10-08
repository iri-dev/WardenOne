/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const WARDEN_SITE_DASH_CATEGORY_IDS = [
  'trackers', 'ads', 'popups', 'cleaned', 'annoyances', 'consent',
  'security', 'sensitive', 'privacy', 'yours', 'other',
];

/* Keep page actions and network-rule matches in the same buckets on every UI surface. */
function wardenSiteDashEventKind(type) {
  const t = String(type || '');
  if (/^(memory_|tab_limit_|forget_me|extension_change|search_junk|youtube_ad_diag|download_|reload_loop)/.test(t)) return '';
  if (/^(warned_|detected_|proposed_|learned_|gated_|session_token_|login_thirdparty|skimmer_suspected|behavioral_risk)/.test(t)) return 'noticed';
  if (t === 'consent_rejected') return 'consent';
  if (t === 'google_search_cleanup') return 'annoyances';
  if (t === 'scriptlet_mutator_blocked') return 'trackers';
  if (t === 'youtube_ads_removed') return 'ads';
  if (/^(cleaned_|stripped_|purged_)/.test(t)) return 'cleaned';
  if (/popup|redirect|gestureless_nav|meta_refresh|form_submit|frame_top|ad_auction/.test(t)) return 'popups';
  if (/overlay|confirm_bait|autoplay|hidden_media/.test(t)) return 'annoyances';
  if (/tracker|thirdparty_cookie|grabber_pixel|beacon|fingerprint|supercookie/.test(t)) return 'trackers';
  if (/capture|webrtc|geolocation|camera|device_/.test(t)) return 'privacy';
  if (/token_exfil/.test(t)) return 'sensitive';
  if (/^blocked_/.test(t)) return 'security';
  return '';
}

function wardenSiteDashSummarize(report) {
  const cats = {};
  WARDEN_SITE_DASH_CATEGORY_IDS.forEach((id) => { cats[id] = 0; });
  const network = (report && report.network) || {};
  if (network.available) {
    Object.keys(network.byCategory || {}).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(cats, key)) cats[key] += Number(network.byCategory[key]) || 0;
    });
  }
  let noticed = 0;
  const typeCounts = (report && report.page && report.page.typeCounts) || {};
  Object.keys(typeCounts).forEach((type) => {
    const kind = wardenSiteDashEventKind(type);
    const count = Number(typeCounts[type]) || 0;
    if (kind === 'noticed') noticed += count;
    else if (Object.prototype.hasOwnProperty.call(cats, kind)) cats[kind] += count;
  });
  return {
    cats,
    noticed,
    total: WARDEN_SITE_DASH_CATEGORY_IDS.reduce((sum, id) => sum + cats[id], 0),
  };
}

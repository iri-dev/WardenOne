'use strict';
// Standalone unit test of the YouTube prune logic copied verbatim from the
// content script. Proves the deep-walk actually removes the ad SCHEDULE (the
// fields the player reads to decide when to insert an ad) from realistic
// player-response shapes -- not just that the file parses.
//
// v3.18.x update: the walker now HARD-EXCLUDES the streaming/SABR subtree
// (YT_PRUNE_EXCLUDE) so an ad-named token nested under streamingData can never
// corrupt serverAbrStreamingUrl / adaptiveFormats (the black-screen/spinner
// root cause). cleanPlayerText is now fail-safe: on JSON.parse failure it
// returns the body UNCHANGED instead of a blind global key-rename.

const YT_AD_FIELDS = ["playerAds", "adPlacements", "adPlacementsV2", "adSlots", "adBreaks", "adBreakHeartbeatParams", "adBreakServiceParams", "adParams", "playerAdParams", "adSignalsInfo", "adTrackingParams", "adSafetyReason", "adTag", "adUrl", "adVideoId", "adCuePoints", "adCues", "linearAdSequence", "instreamAd", "companionAd", "mediaAd"];
const YT_AD_RENDERER_RE = /^(adPlacementRenderer|instreamVideoAdRenderer|inStreamAdLayoutRenderer|playerLegacyDesktopWatchAdsRenderer|companionAdRenderer|adSlotRenderer|promotedSparklesWebRenderer|promotedVideoRenderer|compactPromotedVideoRenderer|displayAdRenderer|statementBannerRenderer|mealbarPromoRenderer)$/i;
// Streaming/playback subtrees the walker must NEVER descend into, so it can
// never delete or splice a media-critical field. Keyed by property name.
const YT_PRUNE_EXCLUDE = { streamingData: 1, serverAbrStreamingUrl: 1, formats: 1, adaptiveFormats: 1, playerConfig: 1, playbackTracking: 1, videoDetails: 1, captions: 1, storyboards: 1, heartbeatParams: 1, playbackContext: 1 };

// Same logic as content.min.js, written readably for the transplant.
function neutralizeYtAds(target, depth, seen) {
  let hit = false;
  if (!target || typeof target !== "object") return false;
  if (!depth) depth = 0;
  if (!seen) seen = new WeakSet();
  if (seen.has(target)) return false;
  seen.add(target);
  if (Array.isArray(target)) {
    for (let i = target.length - 1; i >= 0; i--) {
      const v = target[i];
      if (v && typeof v === "object" && Object.keys(v).some(k => YT_AD_RENDERER_RE.test(k))) {
        target.splice(i, 1);
        hit = true;
      } else if (depth < 8 && v && typeof v === "object" && neutralizeYtAds(v, depth + 1, seen)) {
        hit = true;
      }
    }
    return hit;
  }
  for (const k of Object.keys(target)) {
    if (YT_AD_FIELDS.indexOf(k) !== -1 || YT_AD_RENDERER_RE.test(k)) {
      delete target[k];
      hit = true;
    } else if (YT_PRUNE_EXCLUDE[k]) {
      // streaming/playback subtree -- leave entirely alone
      continue;
    } else if (depth < 8 && target[k] && typeof target[k] === "object" && neutralizeYtAds(target[k], depth + 1, seen)) {
      hit = true;
    }
  }
  return hit;
}
function stripYtRootLeftovers(o) {
  let hit = false;
  for (const root of [o, o && o.playerResponse]) {
    if (root && typeof root === "object") {
      for (const k of ["no_ads", "important", "legacyImportant"]) {
        if (Object.prototype.hasOwnProperty.call(root, k)) { delete root[k]; hit = true; }
      }
    }
  }
  return hit;
}
// Fail-safe text cleaner: parse -> surgical prune -> stringify; on ANY parse
// failure (truncated/chunked/streamed body) return the ORIGINAL text unchanged
// so a malformed body can never be corrupted (uBlock-Origin .catch(()=>orig)).
function cleanPlayerText(text) {
  try {
    const obj = JSON.parse(text);
    const hit = neutralizeYtAds(obj) | stripYtRootLeftovers(obj);
    return hit ? JSON.stringify(obj) : text;
  } catch (_) {
    return text;
  }
}

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.log("  FAIL: " + name)); };
const hasDeep = (o, key) => JSON.stringify(o).includes('"' + key + '"');

// 1. Top-level watch player response (direct page load shape)
let pr = {
  responseContext: { visitorData: "x" },
  playabilityStatus: { status: "OK" },
  streamingData: { formats: [{ itag: 18, url: "https://real-video" }] },
  adPlacements: [{ adPlacementRenderer: { config: {} } }],
  playerAds: [{ adVideoId: "AD123" }],
  adSlots: [{ adSlotRenderer: {} }],
  videoDetails: { videoId: "REAL", title: "Real Video" }
};
neutralizeYtAds(pr);
ok(!("adPlacements" in pr), "top-level adPlacements removed");
ok(!("playerAds" in pr), "top-level playerAds removed");
ok(!("adSlots" in pr), "top-level adSlots removed");
ok(pr.streamingData && pr.streamingData.formats[0].url === "https://real-video", "real streamingData preserved");
ok(pr.videoDetails && pr.videoDetails.videoId === "REAL", "videoDetails preserved");
ok(!hasDeep(pr, "adPlacementRenderer"), "no ad renderer anywhere in tree");

// 2. Nested under playerResponse (fetch /player wrapper shape)
let wrap = {
  player_response: "ignored",
  playerResponse: {
    adPlacements: [{ adPlacementRenderer: {} }],
    adSlots: [{}],
    streamingData: { adaptiveFormats: [{ url: "https://real" }] }
  }
};
neutralizeYtAds(wrap);
ok(!("adPlacements" in wrap.playerResponse), "nested playerResponse.adPlacements removed");
ok(wrap.playerResponse.streamingData.adaptiveFormats[0].url === "https://real", "nested real data preserved");

// 3. ytInitialData feed with ad renderers in a contents array
let feed = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: [
        { richItemRenderer: { content: { videoRenderer: { videoId: "v1" } } } },
        { adSlotRenderer: { fulfillmentContent: {} } },
        { richItemRenderer: { content: { videoRenderer: { videoId: "v2" } } } },
        { promotedSparklesWebRenderer: {} }
      ] } } } }]
    }
  }
};
neutralizeYtAds(feed);
const gridContents = feed.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
ok(gridContents.length === 2, "feed ad entries spliced out (2 real left of 4)");
ok(gridContents.every(c => c.richItemRenderer), "only real videoRenderers remain in feed");

// 4. "no_ads" leftover from an upstream rename gets cleaned at root
let leftover = { no_ads: [{}], legacyImportant: true, playerResponse: { no_ads: [{}] }, videoDetails: { videoId: "x" } };
stripYtRootLeftovers(leftover);
ok(!("no_ads" in leftover), "root no_ads stripped");
ok(!("legacyImportant" in leftover), "root legacyImportant stripped");
ok(!("no_ads" in leftover.playerResponse), "playerResponse.no_ads stripped");

// 5. Ad-free response must be left byte-identical (no false positives)
let clean = { playabilityStatus: { status: "OK" }, streamingData: { formats: [{ url: "u" }] }, videoDetails: { videoId: "x", author: "Adam" } };
const before = JSON.stringify(clean);
const changed = neutralizeYtAds(clean);
ok(changed === false, "ad-free response reports no change");
ok(JSON.stringify(clean) === before, "ad-free response untouched (incl. 'Adam' author not mistaken for ad)");

// 6. OVER-PRUNE GUARD: an ad-named field nested INSIDE streamingData must survive
let s6 = {
  streamingData: { serverAbrStreamingUrl: "https://sabr", adaptiveFormats: [{ itag: 251, url: "https://real-audio", adParams: "KEEP" }] },
  adPlacements: [{ adPlacementRenderer: {} }],
  videoDetails: { videoId: "x" }
};
neutralizeYtAds(s6);
ok(!("adPlacements" in s6), "[over-prune] top-level adPlacements still removed");
ok(s6.streamingData.serverAbrStreamingUrl === "https://sabr", "[over-prune] serverAbrStreamingUrl preserved (was the black-screen cause)");
ok(s6.streamingData.adaptiveFormats[0].url === "https://real-audio", "[over-prune] adaptiveFormats url preserved");
ok(s6.streamingData.adaptiveFormats[0].adParams === "KEEP", "[over-prune] ad-named field under streamingData NOT deleted");

// 7. OVER-PRUNE GUARD: an ad-renderer-keyed object under streamingData.formats must NOT be spliced
let s7 = { streamingData: { formats: [{ adSlotRenderer: {}, url: "real" }] }, adSlots: [{}] };
neutralizeYtAds(s7);
ok(s7.streamingData.formats.length === 1, "[over-prune] formats element under streamingData not spliced");
ok(s7.streamingData.formats[0].url === "real", "[over-prune] real format url preserved");
ok(!("adSlots" in s7), "[over-prune] top-level adSlots removed");

// 8. FAIL-SAFE: an unparseable / truncated body is returned byte-identical
const truncated = '{"streamingData":{"serverAbrStreamingUrl":"https://sabr"},"adPlacements":[{"adPlacementRenderer":{';
const r8 = cleanPlayerText(truncated);
ok(r8 === truncated, "[fail-safe] unparseable body returned byte-identical (no corruption)");
ok(r8.includes("serverAbrStreamingUrl"), "[fail-safe] streaming url intact in passthrough");

// 9. FAIL-SAFE: a VALID ad-bearing body still prunes ads while preserving streaming
const valid = JSON.stringify({ streamingData: { serverAbrStreamingUrl: "https://sabr", adaptiveFormats: [{ url: "u" }] }, adPlacements: [{ adPlacementRenderer: {} }], playerAds: [{ adVideoId: "AD" }] });
const r9 = JSON.parse(cleanPlayerText(valid));
ok(!("adPlacements" in r9), "[fail-safe] valid body: adPlacements pruned");
ok(!("playerAds" in r9), "[fail-safe] valid body: playerAds pruned");
ok(r9.streamingData.serverAbrStreamingUrl === "https://sabr", "[fail-safe] valid body: serverAbrStreamingUrl preserved");
ok(r9.streamingData.adaptiveFormats[0].url === "u", "[fail-safe] valid body: adaptiveFormats preserved");

// 10. FAIL-SAFE: an ad-free valid body is returned unchanged (no false prune)
const cleanText = JSON.stringify({ streamingData: { formats: [{ url: "u" }] }, videoDetails: { videoId: "x", author: "Adam" } });
ok(cleanPlayerText(cleanText) === cleanText, "[fail-safe] ad-free body returned unchanged");

console.log("\nYT prune unit test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

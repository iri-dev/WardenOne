/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Registered by the worker only while YouTube protection is on for these hosts, so its presence
   is the switch. yt-adblock.js accepts it only before any page script could have run. */
(function () {
  "use strict";
  try { window.__wardenOneYouTubeArm = 1; } catch (_) {}
})();

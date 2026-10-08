# Changelog

## Unreleased

### Added

- OAuth Grant Guard now covers Apple, Meta, Spotify, Slack, Dropbox, GitLab, Atlassian, LinkedIn and Twitch consent screens while keeping ordinary sign-in and basic profile grants quiet.
- Memory Shield's popup has a compact never-sleep site manager for adding a domain or the current site, seeing saved hosts, and removing them. The same list is available in Speed & memory settings.
- Resource Saver has an optional YouTube Ambient Mode control. It hides the decorative watch-page glow without changing video playback or YouTube's saved preference.
- Resource Saver can stop recognised muted card and hover video previews across sites. Normal players, videos with controls and manually started inline videos are left alone, and the option is off by default.
- Resource Saver has an advanced WebGL control with Off, selected-site and everywhere modes, a current-site shortcut, and separate disabled and allowed site lists. It remains off by default because 3D sites can break without WebGL.
- EyeShield site profiles can inherit global settings, save custom theme and colour adjustments,
  or turn EyeShield off for a site. The popup keeps the main EyeShield controls visible and
  uses a small scope menu to autosave global or current-site settings. Settings manages
  global defaults and all saved profiles. Off sites are excluded from
  EyeShield's content-script registration.

### Changed

- Fresh installs and the Recommended profile now stop WardenOne's narrow high-confidence
  phishing tier by default. Medium-confidence address heuristics still warn without blocking,
  and the blocking screen keeps its explicit option to continue.

### Fixed

- Browser Back and Forward navigation from a video page no longer triggers the frame redirect
  warning when returning to a search page.
- Popup controls stay visible while a saved section order is being read from extension storage.
- Closeable media adverts placed over a site's video player are now removed by the in-page popup
  cleaner while the player itself remains protected.
- Settings' Recent site card now includes page-level actions such as YouTube player ad removals,
  so its ad count agrees with the popup instead of showing network-rule matches alone.
- Phishing lookalike detection now derives 1,792 ASCII-brand mappings from Unicode 18.0 UTS #39 data, covering many more Latin, Greek, Armenian, Coptic, Lisu, Cherokee and other script confusables without warning merely because a domain is internationalised.
- Resource Saver's initial-state allowance now matches WardenOne's other frame-heavy bootstrap mechanisms.
- Resource Saver ignores repeated state broadcasts, avoiding duplicate full-page video scans during a single setting change.
- Resource Saver now reads its initial state inside `about:blank`, `srcdoc` and other permitted child frames.
- Muted videos started by the user are no longer treated as previews merely because they use `playsinline` or `loop`.
- Turning video-preview blocking off restores each affected video's original autoplay state and resumes previews WardenOne stopped.
- Simplified Memory Shield's popup layout by removing its repeated mini-headings.
- Popup search keeps the controls inside every matching settings row visible.
- Memory Shield's playing-audio exemption now follows its switch.
- Kept the popup's Maximum tabs and Minimum inactive time inputs visible beside their labels, with a browser visibility check.
- Corrected Tab Limit's popup safety copy so pinned, audio, unsaved-form, and login/payment protections are described as following their Safety switches.
- Explained that video/live platforms and active camera/mic sessions remain protected independently of the Memory Shield Safety switches.
- EyeShield site profiles now reach cross-origin child frames, while Off sites avoid loading the full EyeShield engine in those frames. IPv6 literal hosts can have site profiles.
- Extension Security Centre recognises Volume Master's exact Store identity and expected tab-audio access while still warning about added powerful permissions.
- AdShield also collapses YouTube ad cards that leave a menu or placeholder beside the hidden ad.
- AdShield collapses YouTube's full-width members-only promotion so it no longer leaves a half-filled row or a wide blank area in the feed.
- Disabling YouTube Ambient Mode also removes the home feed's frosted-header colour bleed while preserving the active YouTube or EyeShield theme colour.
- Restored the pause and single-protection controls to the popup's bottom This site panel.
- EyeShield's YouTube light theme keeps the feed's Next button readable without showing
  clipped topics through it. AdShield collapses empty feed cards left by blocked ads.

## 1.0.2 — 2026-10-02

### Added

- The About page shows the source build beside the version in GitHub ZIPs, and support diagnostics
  include the full commit. Verify & Repair results are tied to that build so an earlier 1.0.2 check
  cannot appear to cover newer code.
- A Settings page, opened from the gear in the popup or from the browser's Extension options
  (which used to open Activity history; the popup's Activity link still goes there). It has every
  switch the popup has, grouped by what it protects, and search results that say where each setting
  lives and whether it is on. The overview says whether protection is on, how many of the 108
  protections are enabled, how many settings differ from Recommended and how many that are on may
  affect site compatibility, with the latest changes underneath. Favorites and Recently changed sit
  in the sidebar, and each category shows how many of its settings differ from Recommended.
- Settings can back up your switches together with your blocked and trusted sites, firewall
  decisions, hidden elements, your own filter rules and your subscriptions. Importing shows what
  will change first and only ever adds to your lists. From the same page you can clear browsing
  data and WardenOne's activity history, reset WardenOne, see its browser permissions, add, test or
  remove optional API keys, and see when the protection lists last updated and which sources
  could not be reached.
- Settings also covers what is not a switch: the tab limit's numbers, how soon Memory Shield puts
  tabs to sleep, the Twitch Rewind length, EyeShield's brightness and colour sliders, and how
  notification cards look, last and sound.
- Sites & exceptions in Settings lists every exception you have made: paused sites, protections
  turned off for one site, blocked sites, trusted script and download sites, hidden elements, tabs
  kept awake and firewall rules. Each list can be added to from there, by typing a site, including
  a pause that ends by itself.
- The Settings overview shows what Protection Health says needs attention, the same check the
  popup runs, with a way to put each one right: the setting to change, the page to open, or
  Verify & repair, which is also on the Clean-up page.
- Settings search understands the words people actually use: "ads" finds AdShield, "vpn" finds
  the WebRTC leak protection, "dark mode" finds EyeShield, and small typos like "cokie" still
  find cookie settings, saying which word it searched for instead. Words can come in any order,
  the best match comes first, and quick filters narrow the results to settings that are on, off,
  changed from Recommended, may break sites, or are in your Favorites.
- A Keyboard shortcuts page in Settings lists WardenOne's shortcuts as your browser has them set
  right now, says when a suggested key was not given because something else uses it, and opens
  the browser's shortcuts page to change them.

### Changed

- GitHub Actions now pins current Node 24 releases of checkout, setup-node and upload-artifact.
- GitHub downloads now move the Latest link to a complete commit-specific release after both the
  ZIP and checksum are verified. Older rolling releases and the fixed `latest-build` URL are removed,
  so the Releases page shows one WardenOne Latest build instead of accumulating old builds.
- University and school sites (.edu, .ac.uk and similar) now get WardenOne's page protections.
  They used to skip them entirely so sign-in kept working; now phishing, skimmer, scam and
  form-trap checks run there, and only the protections that can get in the way of signing in, a
  class or an exam are paused. The Site Dashboard says which ones are paused there.
- The Site Dashboard now shows only recorded activity categories, names the WardenOne rulesets
  that matched, and brings protection status forward when nothing was recorded. A live request
  logger link helps inspect new requests; zero counts no longer claim a page had nothing to block.
- Sections in the popup can now be dragged directly with a mouse or after a brief touch hold. The
  dots still drag immediately, and the up and down arrows remain available.
- The popup's logo and title sit near their original header position. The current-site card can
  fold down to its site and status line, and remembers whether it was folded. Its one-line or
  counts layout can be chosen from visual examples in setup's Explore step or in popup settings.
- The setup guide now checks whether WardenOne is already pinned and shows the puzzle icon without
  a fixed arrow that can point at the wrong toolbar button.

### Fixed

- A full reset now rejects a late private-window settings save made from the old config, including
  one that lands after WardenOne restarts. When regular and private Settings edit the same single
  switch together, the later saved edit wins.
- New HTML insertion points now fail the security gate until their exact source lines are reviewed;
  the existing Settings and Twitch Rewind insertion points are recorded as the baseline.
- A setting changed at the same moment as another could be lost: a switch flipped in Settings
  while the popup saved, or just as WardenOne remembered or muted a notification, was sometimes
  undone by the other save. Changes to your settings are now saved one at a time, so both stay.
  A private window saves separately from your regular windows, so a change there at the same
  moment as one in a regular window could still overwrite it; the one that was overwritten is now
  saved again a moment later.
  If your settings ever can't be read, the popup now says so instead of saving over them.
- The Twitch ad blocker and Twitch Rewind now carry the extension's version. From this version
  on, if a newer copy is ever run in a tab that still holds an older one, the old copy lets go of
  everything it held (its network and player hooks, its page styles, Rewind's recorder and
  controls) and the new one takes its place. A copy from 1.0.1 or earlier can't hand its hooks
  back, so a newer copy leaves it running as it was, still following your switches, and the tab
  gets the new one when it reloads. Repair doesn't re-run either script itself: it reloads any
  tab whose protection stops answering, which starts it fresh.
- SteamRIP (steamrip.com) is no longer blocked, or labelled "On a malware and scam blocklist" in
  search results. Only one of the security feeds listed it, and the other sources checked
  disagree, so WardenOne no longer acts on that one listing. That isn't a verdict that the site
  is safe. The fake copies of the site that other feeds list are still blocked, and so is any
  other steamrip.com subdomain a feed lists.

## 1.0.1 — 2026-08-21

Everything below this heading landed after the v1.0.0 release was published. If you
installed from the v1.0.0 download, you do not have any of it.

The headlines: a guide to getting your own API keys, with a link at the bottom of the
popup. Download Shield stops calling ordinary installers dangerous. The privacy
cleaner can clear consent-banner and tracking cookies without signing you out, reset
the camera and microphone permissions sites have collected, and work over a time
range. Warnings stopped repeating themselves, and stopped firing for trackers that
had already been blocked.

The detailed entries are in the 1.0.0 section below, which is where they were written
as the work happened.

### Added

- Update Guardian now checks official Brave, Chrome and Edge Stable release sources when the popup opens, reuses the result for up to six hours while the browser stays open, and uses a compact, lighter status card with browser-specific wording. It still warns when a newer release can be established. Verify & Repair now explains its possible tab reload in plain language.
- The rolling GitHub build now waits for a real Edge popup regression on Windows, covering search, Protection Health, diagnostics, reopening and the master switch.
- Added a source-review ZIP command that archives the committed repository, including source, tests and docs, while excluding untracked local directories. It refuses a dirty checkout unless the user explicitly selects the committed snapshot.
- Extension Security Centre now calls out new bookmark, session, navigation, identity, location, browser-setting, data-deletion and capture permissions with specific impact and review priority. ChatGPT's exact-ID capability contract continues to flag newly added cookie, network, proxy and extension-management access.
- Protection Health can prepare a local diagnostics report for support. Its preview and optional text download contain aggregate counts and states, with no domains, history, keys, or extension names. Verify & Repair now records its last overall result for that report.
- Added a clean-checkout Store release command that runs the full gate and source-rights review before creating a byte-audited ZIP and SHA-256 file. CI now checks README-linked docs and tracks package size, bundled rules and script footprint against reviewed limits. The Store ZIP includes its privacy notice; unresolved source rights still block submission.
- Clarified that the GitHub release checksum and build attestation are optional advanced verification. Future rolling release notes tuck the technical details into an expandable section after installation steps, and the README and download site explain that only the ZIP is needed to install.
- Centered the Blocklist Update now button below the feed details. Publisher dates now show how many feeds have recent dates alongside old and unknown dates, and the health note explains that old editions stay active while automatic checks continue. A source-by-source freshness review records the four currently old headers without removing their rules.
- Recognised the exact OpenAI ChatGPT Chrome extension ID in the local extension catalogue. Its reviewed browser-control and history access are expected; newly added cookie or network-request access, copied names and unpacked installs prompt review.
- On Windows, the suggested palette and clean-address shortcuts are now Alt+Shift+O and Alt+Shift+U. Brave and Edge assigned both on fresh installs and after reloading an existing install where the old W and C suggestions stayed blank. The popup notices an unassigned palette shortcut and offers direct Open palette and Set shortcut buttons. Shortcut guidance now explains browser conflicts and user changes.
- Verified the local Store ZIP contains no inactive Twitch Rewind scripts, settings, popup controls, permission text, privacy disclosures or integrity expectations. The proposed listing now uses the purpose record's exact sentence and explicitly awaits comparison with a future Dashboard draft; Store submission remains blocked by unresolved source rights.
- Strengthened forced-popup protection on ad-heavy embedded video pages. A lightweight settings reply starts the popup guard before the full worker snapshot, transparent links layered over Play no longer steal the click, and the worker closes suspicious frame popups and staged blank popup windows tied to a confirmed player overlay. The player media request stays available.
- Expanded phishing lookalike checks for `2/z`, `6/g`, `8/b`, `9/g`, repeated `1/l` and combinations of visual swaps. Encoded Cyrillic and Greek brand lookalikes are now recognized in the worker, page detector and search results. Ordinary internationalized domains no longer receive a phishing warning merely for using Punycode; the covered cases and limits are recorded in the phishing audit.
- Checked the `/login`, `/verify`, `/account`, and `/oauth` warning reduction against the revision before `10eced2`. A password form that claims to be Discord, Steam, Google or another covered brand on a different domain now uses a matching sign-in path as corroboration for a form-trap warning. Independent sites' own account pages stay clear; `tools/test-phishing-path-intent.js` exercises both cases and records the remaining limits in the phishing audit.
- Moved the README's hash and build-attestation instructions below the normal install guide and labelled both checks optional for advanced users, with a plain-language explanation of what each check establishes.
- Compared phishing verdicts across `10eced2` and added a 1,485-case matrix for every built-in phishing brand in the worker and page detector, including official hosts, independent names, login lures, visual typos and subdomains. The corpus now includes four more independent Discord directories alongside Disboard. Adjacent-letter swaps warn again; a sign-in word inside a brand name or across its suffix no longer causes a worker false positive; the page detector catches nested official-looking domains. The startup sweep checks corroborated subdomain impersonation while leaving ordinary brand-named subdomains alone. See `docs/phishing-differential-audit.md` for the changed warnings and their decisions.
- The rolling GitHub ZIP build now publishes a matching SHA-256 checksum and a GitHub Actions build-provenance attestation before refreshing the `latest-build` release. Release notes include the full source commit, ZIP digest and attestation link; the README and site explain how to verify a downloaded copy.
- Audited every manifest permission against its shipped feature. Browser-history access is now requested only when the separate Forget Me history switch is enabled; denial or revocation leaves history untouched while cookie and storage cleanup can continue. The permissions guide distinguishes the 17 install-time permissions from this optional grant, and `docs/permission-audit.md` records the remaining runtime-permission candidates and their compatibility requirements.
- The toolbar popup keeps its intended 348-pixel width and single-row footer; its separate browser-tab view still reflows at narrow widths. Old feed publisher dates are now informational rather than a "Check setup" warning. Downloaded rules stay active, and the dated sources and explanation live under Blocklist > Publisher dates instead of crowding the health card and Blocklist summary.
- Warning pages now move focus to newly revealed Safe Browsing choices and announce when the delayed continue action becomes available. Download Guard and the popup when opened in a tab reflow at a 320 CSS-pixel viewport; EyeShield sliders expose percentage values to assistive technology. An isolated warning that a page removes and WardenOne restores also restores keyboard focus inside its dialog, and dialog Tab loops skip disabled controls. A real-browser accessibility audit covers keyboard focus, browser accessibility names, narrow reflow and forced colours; spoken Narrator/NVDA verification remains a separate release check.
- Blocklist health now separates WardenOne's fetch time from each remote feed's own dated header. The popup lists publisher dates for network, supplemental, AdShield cosmetic and user-subscribed feeds, shows “publisher date unknown” when no reliable date is provided, and flags dates over 30 days old without disabling the downloaded rules. Protection Health calls out old bundled-feed dates so a recently fetched but abandoned list cannot appear fresh.
- Search results for Disboard and similarly named independent server directories no longer claim they are fake Discord sites. The worker's brand check now requires a closer typo or visual substitution, and a site's own login path no longer turns a brand word in its name into an impersonation warning. Explicit Discord login lures, subdomain spoofs and visual typos still warn.
- The proposed Store package now retains EyeShield's page readability controls and Memory Shield's idle-tab resource controls, including Tab Limit. The Store listing and purpose record explain their roles and acknowledge that single-purpose review is still a reviewer judgment. Twitch Rewind remains outside that package; the GitHub build still carries all four.
- Discord server onboarding dialogs, including role and pronoun pickers, are left to Discord instead of being removed by the generic overlay and confirm-bait cleaners. The exception is limited to Discord's app origins; other protection checks remain active.
- On Twitch pages with chat, the in-page Guard active chip hides instead of floating over the chat. It used to climb above the chat box onto the messages and settle in a different spot as banners, polls and pinned messages came and went. It returns on Twitch pages without chat and when you collapse the chat, hides again when you expand it, follows in-app navigation without a reload, and protection and the browser toolbar badge keep running.
- On Discord server channels, the in-page Guard active chip hides so it does not cover the member list. It remains available in DMs and when a profile popout covers its corner, and follows channel and popout changes without a reload; protection and the browser toolbar badge continue to run.
- The Store rights gate now requires a documented release-owner decision for each upstream input, including review evidence, terms revision, use and notice decisions, and a matching digest for redistributed files. Regenerating the source inventory preserves completed decisions for unchanged inputs; Store submission remains blocked while the 41 current records await review.
- The Privacy cleaner can clear WardenOne records and site exceptions for the current site. Its controls now explain local storage and optional provider lookups in plain language and fit at popup width. It previews affected datasets, preserves other sites' durable records and public protection lists, clears shared derived caches that cannot be separated by site, and rebuilds network rules after the extension restarts. The dataset inventory shows each store's owner and retention policy.
- Security critical toasts get a fixed, isolated copy that survives page removal and requests a browser notification if hidden. Warnings raised before the toast listener starts are delivered when it is ready, and the warning relay captures events before page listeners can stop them.
- The Privacy cleaner can inspect WardenOne's saved local and session datasets by size and known age, then erase all extension-owned storage and dynamic rules. The date preview scans every timestamped record, including records past the first hundred. The erase control can keep global switches, with or without API keys, while removing site exceptions and learned records; active Download Shield reviews must be resolved first.
- High-stakes in-page warnings now also appear in an isolated, closed-shadow overlay with fixed wording and a self-healing owner. If a page covers that copy, WardenOne requests a generic browser notification. The secret-paste continuation rejects scripted clicks.
- Continuing a blocked secret paste now requires a trusted click in the isolated warning. The choice is signed and tied to that specific paste attempt, so a hostile page cannot reuse an earlier choice for a later paste.
- Context-menu and command-palette reputation checks now save a short-lived, target-free session receipt before contacting a provider. If the service worker dies, its next wake reports the interruption; answers are bound to the originating document and cannot be injected into a navigated page.
- Automatic keyed reputation checks now consult hydrated local malware, scam and user-block records before constructing a provider request. Local malicious-list hits use WardenOne's own warning page, and a user-blocked site does not trigger a provider check. Pasting or testing a key still leaves automatic checking off until its separate switch is enabled.
- Settings reconciliation now waits for an active generation to finish, skips duplicate requests for the same state, and runs one queued pass for newer settings. Stable network-rule owners skip work when their own inputs are unchanged, six owners share one dynamic and one session rule read per generation, and intranet switches are part of the desired-state key. SafeSearch settings flow through that pass instead of starting a second direct rule update.
- A supplemental list refresh now waits for its one Grabber feed rule update without starting a duplicate update from the storage-change listener.
- Remote list refreshes now compare the desired rule bands with Chrome's installed rules and skip the DNR transaction when the bands are already identical; the master switch is still checked at the commit boundary.
- When several central rule owners change together, their disjoint changes now share one dynamic and one session Chrome transaction per store. A combined validation failure falls back to separate owner updates so one broken band does not hold back another.
- The "important extension change needs review" note in the popup's status card
  now opens. Click it to see which extension changed, what it gained, the version
  change and when it happened, and then mark it reviewed or open the Security
  Centre without leaving the card. Before, it was just a sentence, and finding out
  which extension it meant took a trip to another page.
- A release performance profile, and the first one. `node tools/perf-profile.js`
  loads the real extension into a real browser (Microsoft Edge; Chrome no longer
  loads unpacked extensions from the command line), measures three local synthetic
  pages with the extension off and on -- five runs each, cold and warm, main-thread
  time, script, layout and style time, long tasks, navigation timing, heap after a
  forced GC -- and writes medians, tails and every raw value to `docs/perf`, tied to
  the commit and the browser version. It refuses to measure unless the extension is
  loaded and its engine has stamped the page, and it carries a deliberately broken
  variant so it can prove it sees a known regression before its numbers are trusted.
  The profile of this build is in `docs/perf/profile-4cd3119.md`; its clearest
  finding is the per-frame cost of the scripts that run in every frame, recorded
  there for the next profile to be measured against.
- A Store package, and a build that knows which package it is. Chrome's Web
  Store allows an extension one narrow purpose; EyeShield, Memory Shield, Tab
  Limit and Twitch Rewind are separate goals from protection, so
  `node tools/build-store-package.js` builds a package without them -- the
  files, the manifest entries and the settings, not just the description --
  from a commit, reproducibly. The worker and the popup read `build-profile.js`
  to run cleanly without what was left out: no tab-sleep menu entries, "not in
  this build" for the memory tools, no EyeShield registration, no sections in
  the popup for what is not there. The GitHub build is unchanged and carries
  everything. The decision, and every popup section's place under the one
  purpose, is recorded in `docs/store-single-purpose.md`, and the gate checks
  the record against the code.
- Spotify Web Player ads are handled the way the established blockers handle them,
  in three layers that all stay on your side of the wire. First, the player's own
  track loader: every track Spotify's player resolves passes through one callback
  carrying the media URL it is about to load, and anything Spotify itself labels an
  ad has that URL replaced there with a one-second silent clip -- nothing about the
  ad is fetched, the clip ends on its own, and the player moves to the next song
  exactly as it would after a real ad. This is the AdGuard technique for
  open.spotify.com, and it does not care which host the ad would have come from;
  it also covers Spotify's manifest-delivered ads, which the AdGuard rule does not
  reach. Second, the network: uBlock Origin's list of Spotify ad-media hosts is
  redirected to the same packaged clip, media type only, so songs (which travel
  over fetch) are never touched. Third, the existing fallback for an ad that
  reached the media element unchanged: recognised from Spotify's own state
  responses, muted before playback, and sought near its end once Spotify confirms
  it is current. The AdShield toggle, or allowlisting open.spotify.com, switches
  all of it off; the short replacement clip is never sought.
- Podcasts on the web player can no longer be cut off by a tracker list. Media the
  web player loads is allowed through the ad and tracker packs (a podcast's audio
  often arrives through an analytics prefix such as chtbl.com, which the EasyPrivacy
  pack blocks for every request type, and a blocked audio request leaves the player
  stuck rather than silent). The exception is scoped to media requests from
  open.spotify.com, sits below the ad-media redirects and the malware blocks, so an
  ad is still silenced and a malicious host is still refused. uBlock Origin carries
  the same exceptions host by host after podcast breakage reports.
- Spotify Web Player ad handling now keeps Spotify's complete playback graph and
  original media URLs untouched. A live repeated-skip trace showed that the
  previous 132 ms silent replacement ended but left Spotify in an empty,
  unskippable Advertisement state. WardenOne instead identifies ad media from
  Spotify's own state responses, mutes it before playback, then seeks the real
  media near its end so the player's native end transition can resume the next
  song. A skip-into-ad regression exposed a second edge: a future ad candidate
  must not be sought before Spotify confirms it is current, and the same ad
  must not be sought again by retry timers. Both are now guarded; without a
  current-ad confirmation, it stays muted and plays through rather than forcing
  a skip cascade. Late ad responses from before the next song started cannot re-arm
  that finished ad. Songs, episodes and podcasts are not sought or muted; the extension
  makes no account-side playback request.
- A live skip burst also exposed a separate failure: Spotify's audio-license endpoint
  sometimes returns HTTP 429, after which the web player can rapidly abandon songs.
  WardenOne now holds only that failed license response for at most ten seconds,
  giving an in-flight successful license a chance to keep the selected song playing
  without manufacturing a license, retrying the DRM request or delaying successful
  playback. A live retest recovered one 429 without the error toast, but a later burst
  of 429s still advanced to another playable track. Aborting the request, disabling
  AdShield or repairing the content script releases the hold immediately.
- The right-click menu can now do something about the tab itself: sleep it, close
  it, or mark its site so it is never slept. Sleeping unloads the tab to give its
  memory back — it stays in the tab strip and comes back when you click it — and you
  land on the next tab along rather than staring at a blank one. Two things stop
  either action and say so: text you have typed and not saved, and a camera or
  microphone in use. The guard is on closing as well because closing a tab this way
  skips the browser's own "leave site?" prompt, so Ctrl+W stays the way to close one
  regardless. "Never sleep this site" is exact rather than site-wide — marking your
  mail keeps your mail awake and says nothing about the rest of that domain — and the
  same entry takes the mark off again.
- Search results you have not clicked yet are now marked when WardenOne already
  knows something bad about where they lead. Every other defence here runs after
  you have gone somewhere; this one runs before. Two things it will never do: call
  a result safe, and hide one. There is no green tick, because "nothing known
  against it" is not the same as "this is fine" and a tick would read as a promise
  nobody can make. A result is marked only from lists already on your machine —
  nothing about what you searched for, or what came back, is sent anywhere to
  produce a badge. Off the local lists, off the network.
- Click-tracking beacons are now removed from links. A link can carry a `ping`
  attribute that quietly notifies a third party when you click it, separately from
  where the link actually goes, and it works even when you open the link in a new
  tab or copy it. WardenOne strips it from links already on the page and from any
  added afterwards, and it is removed on the way through a click as well, so a
  beacon written in at the last moment does not get its request either. This sits
  in link cleanup with the redirect unwrapping rather than arriving as its own
  switch, because it is the same job.
- Tracking parameters that an app adds without loading a page are now cleaned too.
  A single-page app can change what is in your address bar with no navigation at
  all, which is how a campaign tag ends up in a URL you then copy and send to
  someone. Only parameters WardenOne can positively identify as tracking are
  removed. Anything it does not recognise is left exactly as it is: app state,
  search filters and sign-in flows all live in the address bar too, and guessing
  at an unfamiliar parameter breaks pages for no gain.
- The leftovers a redirect tracker writes are now cleared. When site A sends you
  to a tracker on the way to site B, that tracker gets a moment as a first party
  and can write storage that follows you afterwards. WardenOne now clears what it
  left, but only where all of the conditions for a bounce hold — this deliberately
  does not fire for every intermediary in every redirect, because sign-in, payment
  and single-sign-on flows pass through the middle of a redirect too, and clearing
  storage under one of those breaks it.
- Headsets, NFC and game controllers now count as device access. A page reaching
  for a VR or AR session, a contactless tag, or the controllers you have plugged
  in is asking about hardware the same way it does with USB, serial, HID and
  Bluetooth, and it now appears alongside them instead of passing unrecorded.
  Nothing new was added to the settings list for this — it belongs to the hardware
  access you already control. Controller makes and models are never written down;
  the interesting fact is that a page asked, not which pad you own.
- Codec capability probes are now flattened, and never faked. Asking whether a
  video format plays smoothly and efficiently on your machine is a precise
  description of your hardware, and sites ask about many formats in a row to build
  one. Under the fingerprinting shield the smooth and power-efficient answers stop
  varying — but whether a format is supported at all is passed through exactly as
  your browser answered, always. That is the one field a lie would break rather
  than protect: tell a page a codec works when it does not and the video simply
  fails to play.
- Keyboard shortcuts for the things you do repeatedly. These add no protection —
  every one is a faster route to something already there. They run through Chrome's
  own shortcut system rather than a key listener injected into every page, so pages
  cannot see them, cannot intercept them, and cannot tell the extension is present
  by watching for them. Chrome allows four defaults, so four are set and the rest
  ship unassigned for you to bind. The popup lists each one with whatever key
  Chrome currently reports, rather than a table written into the page that would
  be wrong the moment you rebind anything.
- A privacy test that measures rather than asserts. Reading your own settings back
  to you proves nothing; a switch can be on while the protection is not reaching
  the page. So each probe runs twice on the same page — once where the shields have
  patched things, once in a clean view of the same page — and the answer is the
  difference between them. It measures the page in your other tab, not the test
  page. Results come in five levels rather than pass and fail, because "failed" is
  the wrong word for most of what a browser exposes normally. Where it cannot
  measure something honestly it says so instead of grading it. Nothing leaves your
  device, and the page is put back as it was found.
- A command palette with a browser shortcut. Past a certain number of tools, finding one
  becomes the problem rather than lacking one. Type a few letters, press Enter.
  The overlay is display only: it draws a list and reports what you picked, and
  every action behind it is checked by the extension itself — because "pause
  WardenOne on this site" is exactly what a hostile page would reach for if the
  overlay could ask for things on its own. It is injected when you press the key
  and never before; a palette has no reason to sit inside every page you visit for
  the whole of its life.
- The network logger can now name the rule and the list in a packaged build, not
  only an unpacked one. Chrome reports matched rules to a store build through a
  different route than the one used before, so this no longer has to say "not
  reported". That route tells you which rules fired in which tab rather than which
  rule stopped a particular request, so a rule is written against a request only
  where exactly one candidate fits; everything else is counted separately, and a
  rule matched this way says so plainly rather than posing as an exact answer.
- Added a browser-level clean-copy route for the current page address. Chrome
  does not expose ordinary Ctrl+C from its top address bar to extensions, so
  WardenOne now provides a keyboard shortcut and a popup button that copy the active
  page URL after removing known tracking parameters and copied text-fragment
  payloads; the setting text now says exactly which page copies it can clean
  automatically.
- Brought Notifications and Activity into the same page system as the DNS,
  Permissions, and API-key guides, with the shared dark top bar, wide guide hero,
  paper ledger panels, responsive navigation, and clearer local-storage summaries.
- Restored the pre-centre reading-time fade as the shipped default for every toast
  category, including migration of the five old persistent defaults. The content
  runtime and Notification Centre now share the same defaults and type mapping, with
  a regression test that fails if a real page notice falls into history-only system
  messages or the two copies drift again.
- Rebuilt the Notification Centre as a WardenOne page: Recent history with day groups
  and expandable stacked events, plus Preferences for each notification type (Off /
  History only / Toast / Persistent), duration presets, toast corner, history
  retention, grouping, toolbar unread badge, and sound. Sounds stay off until opted
  in; volume, sound mode, per-type sound and Preview live on the same page. A single
  notification manager owns history, toasts, tray notices, badge and offscreen audio
  so individual protections do not invent their own alert code. Existing Activity
  history remains the complete audit trail.
- Matched the Notification and Activity heroes to WardenOne's purple guide-page
  treatment, removed the redundant unread pill from the hero, added clearer lilac
  separation between preference rows, and made the pinned toolbar unread count an
  opt-in setting. Existing installs migrate that toolbar count to off.
- Added a fully local Extension Security Centre. Every installed extension now gets
  three separate, explainable signals: an exact-ID lookup against a bundled incident
  database, its current Chrome capability reach, and its version/permission change
  history. Reviews bind to the exact current snapshot and automatically become stale
  after a meaningful update. The centre includes search and filters, Chrome's own
  permission-warning text, explicit disable and Chrome-confirmed removal controls,
  plus bounded import of a user's own local exact-ID intelligence. The initial
  catalogue has 21 source-linked exact identities, including four historical incident
  records (three bound only to the documented affected version). No extension ID is
  uploaded, “unknown” is never called safe, and powerful access is never called
  malicious without an exact evidence record.
- Added DNS rebinding detection. Intranet protection decides from the hostname a page
  asks for, which is the right call for what it does and no help at all when a
  perfectly ordinary-looking name quietly resolves to your own network. WardenOne now
  watches the address each site actually resolves to, and blocks a name for the rest
  of the session when it comes back pointing at your network, or when it answers
  publicly once and privately the next time - which is what a rebinding attack looks
  like. Being straight about the limit: the browser gives extensions no way to check
  an address before a request goes out, so the request that reveals the trick has
  already happened. This catches everything after it, not the first one. Pages you
  open yourself that live on your own network, like a local dev server, are left
  alone.
- Intranet protection is now enforced at the network layer as well as in the page.
  The page-level guard rewrites what a page can call, and a background worker gets
  its own private copy of those same functions that no rewrite ever reaches - so a
  few lines running in one could reach your network with the guard still sitting
  there. Rewriting workers to close that would break real sites (a strict content
  policy stops them loading at all, module workers lose the paths their imports
  resolve against, and a service worker cannot be rewritten at any price), so the
  same refusal now happens where a request looks identical whichever part of a page
  made it. Pages served from your own network keep full access to it, including to
  other devices on it.
- Added a record of who asks for your cookies across sites. Anything embedded in a
  page - a comment box, a video player, an ad frame - can ask for its cookies back
  across sites through the one route browsers still allow, and until now nobody could
  see who asked. Every request is now recorded with the name of whoever made it,
  requests from known trackers are refused outright, and anything asking while
  invisible or without you having clicked first is flagged. Ordinary embedded
  sign-ins keep working, because they run on the same mechanism. A separate setting
  refuses every request instead; it is off by default and deliberately left out of
  both "Turn everything on" and the maximum-privacy bundle, because switching it on
  is a choice to break embedded logins.
- Full-screen protection now keeps the Escape key working. The warning it shows ends
  with "leave full screen before typing anything", and a page could take that key
  away - leaving the one instruction the warning depends on doing nothing. Escape is
  now filtered out of any key a page asks to capture, and every other key it asked
  for is still granted, so games and presentations are untouched. A page that has
  already been caught drawing a fake address bar is refused outright, and refused the
  ability to hide your cursor along with it.
- Added an opt-in setting that lifts full-screen cookie walls - the consent-or-pay
  sheet that covers the page and freezes scrolling, where there is no "reject" to
  click. Nothing is clicked, so nothing is consented to and no consent cookie is
  written. It is off by default because it cannot always work: on some sites the
  article was never sent to the browser at all, so WardenOne measures what is behind
  the wall and puts the wall back rather than leave a blank page, and publishers who
  keep the wall on a separate domain are out of reach entirely. Built from a
  101-site live test; the notes in `consent-wall.js` record which finding forced
  which part of the design.
- Grouped the three cookie-banner settings together, and each now opens by naming the
  situation it answers: the banner offers a way to refuse, it offers none, or you
  accepted it yourself. "Clear a site's cookies after accepting" used to sit in a
  different section from the other two, with nothing explaining how any of them
  related.
- Added XSS Behavior Guard. It watches values from the URL, `window.name`,
  `postMessage` and the referrer for ones that arrive somewhere code actually runs,
  and records what it saw with a confidence and a severity. It is local, never
  stores the matched value, and does not claim to block XSS - page-originated
  findings are warning-only and can never create a blocking rule.
- Added ClickFix and self-XSS detection for the "run this in PowerShell", "open
  DevTools", "enable pasting" and fake human-verification scripts. A warning needs
  both the instruction and the command, so a page that merely mentions a console is
  left alone.
- Expanded Header Shield with third-party Client Hint reduction, optional strict
  cross-site referrer removal, and opt-in ETag protection limited to known tracker
  infrastructure. First-party, sign-in, CAPTCHA and payment paths stay excluded.
- Added a purple/plum dark theme across every extension page, with persistent Light/Dark
  controls in the popup header, the Interface section, and onboarding. Light mode keeps
  the original WardenOne design, including its native scrollbar geometry and lilac-pink
  selected-mode controls; dark mode uses a flat background while preserving readable
  warning, status, and disabled-control contrast.
- Added back-button trap detection. Some pages push the address you are already on
  every time you press Back, so Back never leaves; scam and fake-alert pages use it
  to keep you where they put you. Pushing history is not the tell, since every
  single-page app does it constantly, so it takes a repeat immediately after Back
  fired. Your history is never rewritten.
- Added visibility for three things nothing could see before: Chrome's native
  payment sheet, idle detection - which reports whether you are at the keyboard and
  whether your screen is locked - and a site asking to install itself as an app.
  Nothing is blocked, since Chrome confirms each one. Only which payment methods
  were offered is recorded, never the amount or the item.
- Added notification-bait and scam-alert detection: the page talking you into
  clicking Allow, and the fake alerts that farmed permissions exist to deliver. The
  bait warning only fires while the answer is still open. Nothing is suppressed and
  the wording is never stored, only which shape it matched. One limit worth stating:
  a notification raised from a service worker's push event is created outside the
  page, where a content script cannot reach it.
- Added hardware-access visibility for WebUSB, Web Serial, WebHID and Web Bluetooth.
  These talk to firmware, serial devices and raw HID, security keys included, and
  nothing watched them before. Two things are recorded: asking, and separately
  reading back a device you allowed on an earlier visit - that one needs no prompt,
  so it is the part that can happen while you are not looking. Nothing is blocked
  and the device itself is never recorded.
- Added Browser-in-the-Browser detection. A page can draw a window inside itself,
  title bar and address bar included, and put its own sign-in form in it. No real
  window opens, so a popup blocker has nothing to block. WardenOne now warns when a
  window-shaped box shows a domain the page does not own and offers somewhere to
  type a password. Online IDEs, design tools, ordinary login modals and the usual
  media hosts are left alone.
- Added full-screen address-bar protection. In full screen the real address bar is
  gone, so a page can paint one of its own and ask for a password with nothing left
  to check it against. WardenOne warns when a page draws a domain it does not own at
  the top of the screen, and offers to leave full screen. Video, games, slideshows
  and maps are untouched.
- Added per-site control. The allowlist turns the whole engine off permanently, so
  one guard misreading one site cost either that guard everywhere or every guard
  there. Two narrower levers now sit beside it in a **This site** panel: pause
  everything here for 15 minutes, an hour or 8 hours, and turn off one protection
  here. A site can only ever switch a protection off, never on.
- Added a record of background reports. Tracking pixels have largely been replaced
  by beacons, and a beacon to a host on no blocklist used to leave no trace at all.
  Third-party ones are now noted in the Activity Center by destination - one entry
  per destination per page, never the payload. Nothing is blocked: ordinary sites
  report crashes and page timings the same way.
- Extended session-token, form-skimmer and payment-card protection into embedded
  frames without loading the full page engine there. A small frame-only layer watches
  outgoing fetch, XHR, beacon, WebSocket and form paths for the exact credential values
  entered or stored in that frame, blocks unrelated destinations, keeps established
  identity and payment processors working, and never records the credential itself.

### Changed

- The privacy policy's summary of when data leaves your device now includes Update Guardian's automatic browser-release check, which runs when the popup opens and has no off switch; the detailed section already described it. The website no longer says every check that contacts an outside service is opt-in.
- Diagnostics labels Brave with its Chromium version and retains that label in the exported report. README review wording now matches version-only extension updates; package metrics explicitly measure the staged-tree ZIP.
- YouTube player-error checks skip reserializing ordinary parsed JSON; escaped and reviver-produced errors still use the full check.
- Consent scans now reuse one document and shadow-root snapshot for container and fallback searches. Banner helpers also avoid querying each container twice while preserving shadow-root controls.
- Consent scanning avoids repeating descendant checks for nested DOM additions. The Memory Shield alarm now shares one tab snapshot and one live check per sleep candidate across throttling, sleeping and group reporting.
- Clarified that SessionShield's exact-value and skimmer checks use bypassable page hooks, while browser network rules independently block covered destinations and direct private-network requests.
- Anti-fingerprinting now leaves core count and device memory native in pages and frames, avoiding page-only substitutions for values a worker can expose. Other opt-in noise remains; worker graphics are still outside the shield.
- Clarified that activity and download-review records can retain lowercase names and short numeric values in URL paths; token-shaped segments, queries and fragments are removed from those records.
- Replaced the README's provisional product images with a complete set captured from
  the real WardenOne build. The main reading path now shows the master switch, first
  run, a held download, File Shield evidence, pre-install extension checking, Activity
  and Notification Centres, Protection Health, the measured Privacy Self-Test, Network
  Logger, Site Firewall and the permission ledger beside the feature each image proves.
  Secondary states and tall control views stay in expandable galleries, and every
  optimised preview opens its full view, so the product is visible without turning the
  README back into an exhausting screenshot wall.
- Rebuilt the GitHub README as a readable, full-scale product showcase in British
  English. Major chapters now use first-level headings, genuine features use second-level
  headings and only a feature's internal parts sit beneath it, giving the long page a clear
  outline during a scroll. The opening keeps the no-account, no-telemetry, no-tracking and
  no-server promise without delaying the product, and explains 106 total as 103
  controllable plus three named watch-only protections. A purpose-cropped view of the real
  popup now introduces WardenOne, while the full onboarding screen sits with First run.
  Slim icon-free purple rules derived from the maintainer's profile design mark only
  genuine chapter changes. The product-name section and original first-person build note
  keep the maintainer's voice. SessionShield, Download Shield, File Shield, network defence,
  Extension Security Centre and verification interfaces have clear protection, tool,
  interface or watch-only identities without invented registry numbers. Three branded
  diagrams explain download decisions, the Download Shield/File Shield boundary and the
  path from an event to a personal rule; short flows make token, ClickFix, extension-update
  and repair behaviour scannable. The obstructed architecture diagram and its generic
  About wrapper have gone, but the underlying architecture, privacy boundaries, technical
  limits and feature detail remain. The manual Explore directory, duplicate feature index
  and repeated return links remain removed, and the security policy routes vulnerability
  reports through GitHub's private reporting flow.

- Remote network and supplemental feeds now keep a keyed semantic fingerprint as
  well as their SHA-256 hash and size/count baseline. A hash change with implausibly
  low content overlap quarantines the whole refresh, preserving the last known-good
  rules instead of silently accepting a same-size substitution or dropping only the
  rejected source from a partially rebuilt ruleset.
- Extension storage is now restricted to trusted extension pages and workers.
  Content scripts no longer read the full local store beside arbitrary websites;
  they request a bounded background snapshot that excludes provider API keys,
  private confirmation state, activity details and unknown future fields, with a
  tab-only rate limit and live refresh path.

- Twitch's client-side ad refusal now survives the ad SDK reset that runs when a
  long-lived player rebuilds or changes content. That reset used to clear WardenOne's
  decline after it had been applied successfully, leaving the same tab able to fetch
  a full-player creative hours or days later. Twitch's early ad warning now starts a
  clean alternate stream's two playable edge choices before the native ad poll begins;
  a cold fallback still starts them before Twitch receives the replacement playlist,
  then hands the player's matching request the already-started response instead of
  making it download the same segment again. Fragmented-MP4 streams do the same for
  their decoder init map. Unused work is bounded and cancelled on a channel or setting
  change, ranged media stays native, and none of this changes quality, seeking, pausing
  or the playlist response deadline.
- Rebuilt Extension Security Centre trust decisions around exact, evidence-bound
  contracts. Publisher-verified identities, catalogue-only Web Store listings and
  documented incidents are now separate states; a store-list snapshot can no longer
  excuse powerful access. Only a bundled per-ID contract can mark capabilities as
  expected, and imported records cannot borrow one. Development, sideloaded or
  unclassified copies of a verified ID are surfaced as source mismatches. Base Chrome
  capabilities such as clipboard read, blocking web requests and all-site access now
  participate in the contract check even when no hand-written database signature
  exists. The popup shows decisions rather than duplicating a debug-style permission
  dump, while the full Centre puts the action queue first and folds quiet verified
  extensions away. Bitwarden and Claude remain calm for their documented normal
  access, but gain a warning for access outside their own contract. Bitwarden's
  officially declared clipboard read is now explained by an exact-ID override for
  copying credentials for you to paste and safely clearing them; that exception is
  not inherited by another password manager merely because it has the same category.
- Cookie stripping now covers every kind of request on domains that exist only to
  track you. Across the web generally it stays limited to tracking pixels and beacons,
  and that limit is deliberate: signing in and single sign-on set their cookies on
  frames, scripts and background requests, and stripping those signs you out. That
  reasoning does not apply to an ad network, which is never the far side of a sign-in
  - and a tracker setting a cookie reaches for a frame or a script long before it
  reaches for a pixel. So the wider version arrived as a second rule scoped to the
  known-tracker list rather than by loosening the first one.
- Anti-fingerprinting now answers the newer measuring surfaces: the fonts installed
  on your machine, the monitors attached to it, whether there is more than one at all,
  your keyboard layout, and the text-to-speech voices your system shipped with. Each
  answer is kept consistent with what WardenOne already reports elsewhere - the screen
  layout uses the same dimensions the rest of the engine claims, the keyboard matches
  the language it says you speak - because two different answers to one question
  identify someone better than either answer on its own. The font list is declined the
  way the permission prompt itself is declined, which is what most people do anyway;
  a tidy list of twenty universal fonts would stand out more than saying no, since real
  machines have hundreds. Speech voices are filtered to the language rather than
  emptied, so pages that read aloud keep working.
- Blocking a malware or phishing domain now covers every kind of request a browser
  can make, rather than six of the fifteen. The missing ones included WebTransport, a
  full two-way channel to the same server, so a blocked site was still reachable by a
  page simply choosing a different way to connect. Tracker and ad rules stay narrower
  on purpose, since those lists are far larger and an occasional wrong entry should
  fail visibly rather than quietly mangle a page - but they now cover every plain
  data channel too.
- Anti-fingerprinting now answers for WebGPU, and answers consistently. Sites can ask
  a newer graphics interface the same question the older one already answered, and
  giving two different replies is worse than giving neither: the contradiction is
  rarer than the truth and gives away that something is rewriting one of them. Both
  now come from a single per-session identity, and the capability numbers WebGPU
  reports are the standard minimums every machine supports, so users of the shield
  look alike rather than uniquely odd.
- Cross-site cookie blocking now does what its name says inside tracker frames. The
  network half only ever removed cookies from tracking pixels and beacons - correctly
  so, because sign-in and federation set theirs on frames and scripts, and stripping
  those signs you out - and the half meant to cover frames had never run, because it
  lived in a script that is only injected into the top of a page. It now runs where
  frames actually are, limited to a fixed list of hosts that exist only to track.
- The setting's description was rewritten to say what it really covers. It had named
  frames, which was the one thing it did not do.
- Closed a way to the microphone that "Block camera & microphone" did not cover. Media
  Shield hooks getUserMedia; speech recognition does not go through it, so a page could
  call start() and be listening while the microphone guard reported nothing at all. That
  is worse than an API nobody had got to yet - the switch is a promise about the
  microphone, and there was a route to the microphone it did not close. It does now.
  Worth knowing either way: Chrome does not do this on your machine. The audio from your
  microphone is sent away to be transcribed, so it is not only listening, it is listening
  somewhere else. With the switch off it is recorded rather than blocked, and trusted
  media hosts stay exempt exactly as they are for camera and microphone.
  Refusing is done the way the browser refuses: start() returns nothing whether it works
  or not, so throwing would break pages that never expected an exception. What every page
  using this has already written is the path for someone clicking Block - an error
  carrying "not-allowed", then end - so that is the path the refusal takes.
- Added MIDI to the hardware group, the one device API that had been missed. It does not
  fit the shape of the others - there is no navigator.midi object with a request and an
  enumerate on it, just a single call - which is most of why it was passed over. Two levels
  are recorded separately, and the gap between them is the point: plain access enumerates
  the music hardware attached to your machine, which is a fingerprint most people would not
  guess they were handing over, while sysex is the channel a device own firmware listens
  on, so a page holding it is not playing notes, it is talking to the hardware. That one
  carries the same severity as raw HID.
- Added a note when a site installs a service worker. It is the one thing a page can leave
  behind: once registered it stays after the tab closes and sits in front of every request
  to that site from then on, including visits later. That is how offline and push work, so
  nothing is blocked - but a script that was compromised for an afternoon can leave one
  that lasts. It is also the reachable half of a limit already noted here: a notification
  raised from a worker push event is created outside the page where a content script cannot
  go, but the registration itself is right there. How much of the site the worker covers is
  recorded; the path it was registered from is not.
- Extended hardware-access visibility to cover the File System Access API, which was the
  one thing in that family nothing watched. `showDirectoryPicker()` gives a site read - or
  with readwrite, write - over a whole folder tree on your machine, and the grant survives
  the visit, because the site can keep the handle and come back to it. That is a wider
  reach than any of WebUSB, Web Serial, WebHID or Bluetooth, all four of which were
  already recorded, and "pick your Downloads folder so we can scan it" is a shape scams
  already use. Nothing is blocked, for the same reason nothing is blocked for the device
  APIs: Chrome's own picker is the real gate and web editors, photo tools and IDEs use
  these properly every day. Two things are recorded - asking, and separately still holding
  access granted on an earlier visit, which needs no prompt at all and is the part that
  can happen while you are not looking. The file and the folder are never recorded, only
  which kind of access and whether it was read or write.
- A page that switches WardenOne's in-page engine off is now noticed, and the engine
  is put back. The engine runs in the same world as the page, so the page can reach it
  and turn it off - that is a limit of how browser extensions inject page-level code and
  cannot be prevented from inside that world. The engine already answered half of it, by
  clearing its own health markers when disposed so the tab stops claiming to be protected
  and a fresh copy can take hold. What was missing was anything to install that fresh
  copy: one call as the page loaded switched the engine off for the whole visit, silently.
  The part of WardenOne the page cannot reach now watches for that, has the worker confirm
  it rather than take its word, reinstalls the engine, and writes it down. A page doing
  this to you is worth knowing about in its own right.
- Back-button traps are now stopped, not just reported, and all three shapes of them
  are covered rather than only the obvious one:
  - Putting the address you are already on straight back into your history each time
    you press Back. The first is allowed, since a single re-add right after Back can
    be an app restoring a modal; every one after it is declined.
  - Stacking entries while you read, so the page you came from ends up buried and Back
    has to be pressed once for every entry before it can leave. Nothing asked for any
    of them, which is what separates it from an app you are using, so beyond a small
    allowance they are declined.
  - Sending you forward again the instant you press Back, undoing it. Declined only
    inside the moment after Back, so an ordinary Next button still works.

  The test for all three is whether anything you did asked for it: every interaction -
  click, key, scroll - vouches for the history changes that follow, which is why an app
  you are actually using is never affected. Nothing already in your history is changed
  or removed; declining to add an entry is a different thing from taking one away, and
  WardenOne never navigates you itself.
- Three settings that only ever wrote to the Activity Center are no longer settings.
  Background reports, hardware access and browser capabilities block nothing and change
  nothing on the page, so a switch implied there was protection to turn off when there
  was not. They are now listed together under "What WardenOne watches", which says
  plainly that they observe and never block. The master switch and the site allowlist
  still turn them off with everything else.
  Back-button traps started in that group and left it: once it began refusing a page's
  history calls rather than only noting them, it was changing what the page could do,
  which is exactly the line that decides whether something gets a switch. It has one,
  on by default.
- The three separate switches for frame-driven redirects, fake confirm boxes and
  floating ad frames are now one, "Block popup and redirect tricks". They arrived
  separately while chasing one site's popups and read as three unrelated settings,
  but they are one behaviour: a page trying to take a click it can spend, or move
  your tab out from under you. Turning any of the three off individually is no
  longer possible; the merged switch defaults to on as all three did.
- Rewrote the two IP-logger descriptions, which were half-sentence stubs while
  everything around them was a paragraph, and said nothing about what each one
  actually does or which half of the problem it covers.

### Fixed

- Twitch chat badge observation now follows engine teardown, including its pending debounce, so
  repairing a long-lived tab cannot leave old sidebar observers running.
- Twitch's initial page configuration now carries the saved Steadier Playback setting, so a
  Twitch navigation does not briefly apply the default while the bridge finishes its update.
- Twitch's clean-backup blocking reload now gives its manifest polls the remaining hold budget,
  so a slow final poll cannot extend the promised 1.5-second playback hold.
- Twitch's Steadier Playback preference hook now restores the native storage method when an
  older Twitch module is replaced, so a repaired tab follows the replacement module's setting.
- Twitch ad breaks no longer freeze the stream. While AdShield plays the clean stream through a break, a request that would bring no new video is now held until the clean stream has the next piece ready, instead of leaving the player to run dry. A new "Steadier Twitch playback" switch, on by default, also turns Twitch's Low Latency mode off unless you switched it on yourself, so the player keeps a few seconds of video buffered. On a live channel the buffer through breaks went from running empty, with a 3.5-second freeze, to never dropping below 3 seconds. The stream sits a few seconds further behind live; turn the switch off to keep Twitch's default.
- Twitch local rewind records its copy of the stream at up to 30 frames a second instead of the stream's 60, which cuts its CPU use. Recording at full frame rate added more than a CPU core on a six-core desktop, and under that load Twitch's own picture dropped frames and stepped down in quality. The live picture is unchanged; rewound video plays at 30 frames a second.
- Closing a tab, opening the popup or any other action after a quiet half-minute no longer freezes the browser for about a second. Waking up, WardenOne asked the browser for all ~22,000 of its network rules six times to check a few hundred of its own, and each answer stalled the tab strip and scrolling. The first settings change after a wake did the same, and "Block this site" read every rule to confirm its one. Each now reads only the rules it is checking, and the learned-site and tracker rules are no longer rewritten when nothing changed.
- Stopped the popup from repeatedly reading notification history when no history exists. The empty state now settles after one read, removing the continuous work that made scrolling sluggish on fresh profiles.
- The popup now stops restoring its old scroll position when you start interacting, and avoids repeated storage writes during quick up-and-down scrolling or when it closes.
- Protection Health now uses a short, plain-language summary when a page has not confirmed protection. The expanded panel keeps the reason and next step; "You're safe" still requires a confirmed page check.
- Update Guardian now flags Brave on Chromium 153 against Brave's documented Chromium 154 desktop release. It identifies Brave through the browser API, uses Chromium rather than the Brave product version, and no longer calls an unverified browser "current".
- Removed the disabled consent page-unlock code and its delayed no-op calls. Auto-reject still clicks only safe consent choices; the separate consent-wall feature handles its own guarded lock release.
- Duplicate-tab cleanup now compares full addresses, including hash routes, keeps active or protected copies, and closes only copies whose live state can be checked safely. The popup no longer promises exactly one remaining copy.
- Tab Limit Close rechecks the live tab and window count before removal, skipping tabs activated, used, protected or navigated since selection.
- Memory Shield no longer sleeps a tab you switch to, use, navigate, pin or close while it is checking that tab for unsaved work. The timed sweep, Free RAM Now, group sleeping and the popup's Sleep and Close buttons now look at the tab again right before acting, as Tab Limit already did, and leave it if anything changed.
- Memory Shield now counts and logs a tab as slept only when Chrome confirms the discard, including Free RAM Now, Tab Limit, manual tab actions and group sleeping.
- Popup search restoration waits for all popup scripts before loading saved settings, avoiding a startup race that could lose the visible search on reopen.
- Script Shield stays visible when a settings search matches one of its rows, including WebAssembly. Clearing the search restores the full section. Turning the master switch off also keeps the toast and badge controls dimmed when Silent Mode is off.
- Eye Shield now limits foreign stylesheet processing to 64 connected sheets per
  frame, 4 million source characters and 2 million transformed characters.
  Detached sheets leave the cache and failed or budget-skipped sheets retry only
  after a delay, so long-lived pages do not accumulate every old CSS URL.
- Provider setup now warns where Google Safe Browsing and two WhoisXML APIs require
  URL query credentials. Their clients return generic failure text so a thrown URL
  or provider error cannot echo an API key into WardenOne's notices. WhoisXML's
  WHOIS-record lookup continues using its supported authorization header.
- The tracking-parameter cleaner now has its own visible popup switch and counts
  among the 108 protections. The link-click ping switch controls ping removal
  independently; ordinary link and form destinations remain untouched.
- Mail Shield now stops its observer in open mail tabs and reading-pane frames as
  soon as its switch turns off, and resumes one observer when turned back on.
  Existing matching frames are injected on enable, while a recycled pixel image
  with a new lazy URL is checked again.
- File Shield reads ZIP indexes in 64 KB chunks with an 8 MB inspection budget,
  validates ZIP64 offsets, and labels partial archive reports. Whole-file hashing
  now stops at 32 MB and runs the two digests in sequence; a superseded scan stops
  reading further archive chunks.
- Pages now receive only their own allowlist decision. The global allow/forget lists,
  per-site Eye Shield settings, private memory exceptions and DNS quarantine hosts stay
  outside the page config; browser network rules continue enforcing quarantines.
- Reputation checks keep the complete canonical page address for identity and use SHA-256
  cache keys. Provider paths beyond their limit are skipped instead of being shortened
  into another URL, preventing two long URLs from sharing a verdict.
- Maximum Privacy no longer changes canvas pixels, readback or image exports, including
  OffscreenCanvas. Artwork, signatures and generated images retain their authored content;
  the optional mode continues to change other fingerprint surfaces.
- Maximum Privacy leaves getClientRects() native, preserving the browser's DOMRectList type
  and its methods for editors, selection tools and layout libraries.
- Back-trap protection now permits a SPA to create many distinct startup routes and ignores
  replaceState when counting history entries. It still stops rapid repeated or alternating
  pushState calls and a page that re-arms the same address immediately after Back.
- Link Cleanup no longer edits live anchor, area or form destinations, preserving signed
  downloads, login links and application query state. Explicit Clean copied links remains
  available, and click-tracking ping attributes are still removed.
- Media Shield now checks hidden video at the moment of a gestureless play request. It leaves
  hidden audio and the page's autoplay, mute and pause state untouched, so accessibility alerts
  and reused player elements keep their original behavior.
- Location Privacy now blocks geolocation without changing the browser's language, timezone,
  clock offset or Accept-Language header. Dates and locale-sensitive sites see one coherent
  native environment, including across daylight-saving changes.
- Private-window site changes now report whether they were actually saved. Element Zapper says
  when a hidden element will return after reload, script trust refuses an unsaved change, and
  JavaScript exceptions identify their session-only scope. The popup also refuses to save a
  private site's protection exception into the regular profile.
- The privacy self-test no longer reports WebRTC or local fonts as protected when a probe failed
  or the browser never offered the API. Failed probes are shown as untested and excluded from the
  headline score.
- Pasting or testing a reputation-provider API key no longer turns on automatic checks. A separate
  provider switch now authorizes those requests; saved keys can still be used for manual checks.
  The popup and privacy policy explain that providers can link checked addresses to the reader's
  own account through the key.
- Operating-system notifications now show generic alert categories, keeping site names, download
  filenames and extension names inside WardenOne even when a notice stays until dismissed.
- Release archives now fail the gate if they contain files outside the reviewed package inventory,
  including Chrome's generated metadata, nested ZIPs and private notes. The rolling build checks
  its final ZIP before publishing it.
- The manifest now declares its actual whole-web host scope without a misleading partial list
  of outside services. The Permissions page explains where that scope is used.
- Maximum Privacy keeps real touch, PDF and network-connection capabilities available to sites.
  Its screen dimensions round down and its usable area stays within the real screen, avoiding
  layouts that extend under the taskbar or dock.
- Maximum Privacy now leaves WebGL and WebGPU graphics identities native on macOS, Linux and
  unknown platforms. Its Direct3D profile is used only when Windows platform signals agree, so
  the graphics adapter no longer contradicts the browser's reported operating system.
- A website can no longer fake WardenOne's findings about itself. WardenOne's parts on a page talk
  over an internal channel the page can also listen to and write to. They already signed the
  messages that make WardenOne act, such as settings and redirect warnings, but the security
  findings were checked only by a label the page can read. A site could plant "card theft
  blocked" entries in your Activity log, add to the badge counts and pop up WardenOne's own
  notices over itself. It could also raise the "this page keeps reloading" panel, or tell Memory
  Shield its camera had switched off so the tab could be put to sleep mid-call. All of these are
  now signed with a secret key that the page can never see, and anything unsigned is ignored.
- While fixing that, WardenOne found a bigger problem underneath it. The signing ran inside the
  page's own script environment, and passed the secret key through built-in functions that a
  page can quietly replace. A hostile page could have captured the key the next time WardenOne
  signed anything, which happens every few seconds. It could then forge any of WardenOne's
  signed messages, including the ones that change settings. The key is now turned into its
  signing form once, before any page script exists, and signing no longer touches anything a
  page can replace. Tests attack every copy of the signing code the way a page would.
- IPv6 link-local addresses from `fe90::` to `febf::` were treated as public internet addresses.
  Only `fe80::` was recognised, but the private range runs from `fe80` to `febf`. So Download
  Shield could re-fetch a file from a device on your local network to check it, and other local
  address checks could be fooled. A private IPv4 address written in IPv6 form (`[::ffff:10.0.0.1]`)
  also got past the network rule that stops web pages reaching your local network. WardenOne's
  address checks now share one classifier, and a test holds them all to the same answer.
- The Permissions page's "What can leave the browser" list now covers everything WardenOne
  contacts. It listed only the reputation checks you switch on, all under an "opt-in" banner.
  It left out the daily filter-list downloads, Script Drift's re-checks of third-party scripts
  and the Twitch requests, which all run without a click, plus the extension checker's Web
  Store lookup and the network self-test. Those now appear in their own "Automatic" group, and
  the page names every address. A test holds the page to the same list as the privacy policy,
  built from the code. That test had never been run: the gate counted it as wired because its
  name appeared in the syntax-check list. The gate now counts a test only if it runs it.
- The support note's link to the README, and the privacy policy's link to the list of filter
  sources, were dead on the published website, because neither file is published there. Both
  now point at the repository.
- Videos on streaming sites whose player loads the video itself, piece by piece (as
  JW Player, hls.js and similar do), play again. Video hosts put a
  one-time pass in each video link (`master.m3u8?token=…`). WardenOne's
  session-token guard took that pass for your login token leaving the page, and
  blocked it. The player then gave up with "This video file cannot be played
  (Error Code: 232011)". Subtitles were blocked too, just because their web
  addresses contain long ID codes. What decides it now is where a link came from,
  not what it looks like: a link that a server sent to the page (in the player's
  list of sources, in a playlist, in a video manifest) goes through, pass and all.
  A token that a script only holds in memory was never sent to the page inside a
  link to some other site, so it is still blocked, however the link is dressed up.
  Links that merely echo what the page just sent, or that a script builds for
  itself, don't count as sent. Some players are sent an encrypted source list and
  decode the first playlist themselves. For those, that one playlist request is
  also allowed, but only from a page that is actually playing video, and never
  with a token or password the site has stored or you've typed in. Everything that
  playlist leads to must still have come from a server. In embedded players, plain
  ID codes in a web address's path no longer count as tokens, but long mixed-case
  codes that look like secrets still do.
- If GitHub, ChatGPT or YouTube Music change how their own light and dark themes
  are switched, EyeShield no longer leaves them unthemed. After switching one of
  these sites, EyeShield checks a few seconds later that the page really changed.
  If it clearly didn't, it themes that page the way it themes any other site.
- In dark mode, the "This page: …" line in the popup's status card was a pale
  grey box. It now matches the rest of the card.
- Changing EyeShield's mode applies to the page you're on straight away. Picking a
  new mode sent it to the open tab, and then the tab asked for its settings again
  and was answered from a copy taken before the change -- so it went straight back
  to the old mode, and only pressing Save a second time made the new one stick.
  Open tabs now wait for the updated settings instead of taking the old copy, and
  never let an older copy undo a change they've already been sent. A tab that was
  open before EyeShield was turned on (or before an update) also gets the site
  themes for GitHub, YouTube Music and the other tuned sites when the popup
  refreshes it, instead of the plain generic theme.
- YouTube's play, volume and other player buttons stay visible under EyeShield.
  YouTube's redesigned player draws each control on a faint dark pill, and those
  pills are what keep a white icon readable over a bright frame. EyeShield cleared
  every button and every box in the player's control bar to transparent, so on a
  light video the controls vanished in every mode -- the autoplay switch lost its
  knob too. The controls now keep YouTube's own paint; EyeShield only makes sure the
  player's text stays white.
- YouTube Music works with every EyeShield mode, and its album and playlist covers
  show again. YouTube Music is its own app and shares none of YouTube's page
  structure, so almost none of the YouTube theme applied to it -- except one rule
  that painted the overlay YouTube Music lays over every cover, turning each one
  into a black square in Ultra and a white one in Light. It now has its own
  profile. Light is a real light theme: YouTube's own light colours for everything
  YouTube Music shares with YouTube, its own surfaces turned light, and only what it
  hard-codes for a dark page rewritten -- white text and icons made dark, and the
  faint white tint behind chips made a faint grey one -- while covers, the play
  buttons on them and the album art are left as they are. Dark and Ultra now look
  different from Normal and from each other. Before, all three looked identical:
  YouTube Music is already almost black, and Ultra's colours never reached the parts
  you can see. Dark is calmer: the coloured artwork wash behind the top of the page
  is gone, and the grey chips, search box, sidebar highlight and buttons are dimmer.
  Ultra is true black: the page, sidebar and player bar are black, controls are drawn
  as crisp outlines instead of grey blocks, and the grey secondary text is brighter.
  Neither mode makes anything lighter, and the filter chip you have selected stays
  white.
- GitHub keeps its own design under EyeShield. The search box showed nothing as you
  typed -- GitHub draws the typed text on a layer behind a see-through box, and
  EyeShield painted the box solid -- every file name and commit message came out in
  the same washed-out blue, and icons were drawn heavier than GitHub draws them.
  EyeShield now switches GitHub to its own light or dark theme instead of repainting
  it. Ultra takes the page to true black and GitHub's grey buttons, inputs, panels
  and cards to near-black, keeping GitHub's borders so the layout still reads -- if
  you already use GitHub's dark theme, Ultra is the deeper version of it. When you're signed in,
  GitHub only loads the theme you picked, so EyeShield fetches GitHub's other
  theme stylesheet the way GitHub's own theme picker does and switches once it has
  arrived -- until then, or if it can't load, GitHub stays exactly as it was
  rather than half-switched (the black page with dark text, white buttons and
  missing icons). Your chosen dark variant (dimmed, high contrast) is used when
  it's available. Turning EyeShield off puts back whatever theme GitHub had.
- ChatGPT keeps its own design under EyeShield. Its send and voice buttons are
  solid discs, white with a black icon in dark mode, and EyeShield forced every
  button's icon to white -- a blank, pale circle beside the message box. In Light
  the message box stayed dark and your conversations in the sidebar were nearly
  invisible. EyeShield now switches ChatGPT between its own light and dark themes,
  the same switch ChatGPT's settings use -- on every part of the page that carries
  it, including menus and panels ChatGPT adds or redraws later. When you're signed
  in, ChatGPT keeps that switch in a different place from the signed-out pages,
  which EyeShield never touched, so a signed-in chat in Light kept its black page,
  sidebar and message box with dark text on top. EyeShield now switches both, and
  turning it off puts back exactly what ChatGPT had. ChatGPT's own dark theme is
  already pure black, so Ultra looked no different from it. Ultra now goes further:
  the message box turns black with a thin outline instead of grey, buttons, menus
  and cards go near-black, and text and icons go pure white. Dark is ChatGPT's own
  dark theme, so if ChatGPT is already dark for you, it looks the same as
  EyeShield off. Your accent and message colours stay as ChatGPT shows them.
- Pausing a Twitch stream no longer blanks the page. Turbo users and channel
  subscribers get a "Stream Rewind" tip in the player when they pause, and
  WardenOne's fake-confirm-box sweep took it for one: a short box, a title
  starting "Stream", no link. It removed the tip on sight, the badge said "1
  blocked", and Twitch's player broke on its next update and left nothing but
  the dark background. The sweep deletes what it judges, and on Twitch, YouTube,
  Spotify and X the page is the site's own app, so it no longer runs there --
  fake boxes on those sites come from other people's frames, and the sweep still
  runs inside those. It also stopped reading a box's title as a button: when a
  box's real buttons are icons, the words around them are its message.
- Looking up a Windows command no longer gets it called a scam. Searching for
  `sfc /scannow` or a list of useful CMD commands put the red ClickFix panel over
  the results, and a page listing Run commands -- `wscui.cpl` for Windows Security
  Center, `mstsc` for Remote Desktop -- was locked as a tech-support scam. Three
  things were wrong. A results page is other sites' snippets, and the page-text
  checks (ClickFix, Scam Lock, fake updates) read it as the page talking to you;
  they now leave the results pages of Google, Bing, DuckDuckGo, Brave, Yahoo and
  the other main engines alone, as they already did AI assistants, and anything a
  page copies to your clipboard is still checked there. The ClickFix guard also
  took "type" and "press Enter" near a shell as paste instructions, so every
  tutorial that says "open Command Prompt, type this, press Enter" looked like the
  trick. Steps that only have you type a command you can read are left alone now;
  steps that have you paste something you were never shown -- the Run box and
  Ctrl+V -- or put a download-and-run command in front of you are still warned
  about. And Scam Lock took two names for a scam. A Windows product name beside a
  remote-support tool is not enough any more: a scam page also says your PC is
  locked or infected, or gives a number to call, and those are still caught. The
  search-engine list is one exact list now; the adult-content filter kept its own
  copy, which let hosts like `google.attacker.com` skip it.
- The corner badge can be pressed on Twitch again, and stays where it is. Twitch's
  page never scrolls, so everything in its layout counts as anchored, and the
  badge's corner is the chat box: the Chat button under the badge, the message
  field directly above it, and above that the chat list, which on a quiet channel
  is a focusable region the height of the whole column. The badge knew how to step
  clear of one control, but every spot it tried was "taken": by the message field,
  then by that page-tall region it could never clear -- so it stayed put and stopped
  taking input, visible and dead, from the first time the stream resumed after a
  blocked ad break, which is when it re-checks its corner; and a panel left open at
  that moment was stranded, with nothing able to close it. Three changes. It climbs:
  a spot taken by another control leads to the next spot above it, a bounded number
  of times. A control taller than the badge could ever move -- a focusable column,
  a page-tall wrapper -- is a region, not something the reader is aiming at, and is
  no longer yielded to (an embedded frame still is: what is inside it cannot be
  seen). And a re-check keeps the spot the badge already holds while it is still
  clear, instead of climbing again from scratch and landing a few rows higher or
  lower each time the stream fired an event; it comes home when the corner is clear.
  A panel left open when the badge does stop taking input is closed rather than
  stranded. Checked in a real browser with the extension loaded, on a busy channel
  and a quiet one: the badge sits above the chat box and opens on every click.
- Search results are no longer marked "Looks like Steam, but is not Steam" just
  because the site's name contains the word. A search for "steamrip" carried that
  badge on every steamrip.com result, and steamdb, protondb, applebees and
  blog.google would have carried theirs: the worker's brand rule flagged any
  domain that merely contained a brand word, while the in-page rule had long
  required a sign-in word beside it. The two now agree. A name that contains a
  brand is left alone; one dressed as a login, verify or secure destination, a
  brand as a subdomain of someone else's site, an official brand domain moved to
  another top-level domain (steamcommunity.ru), a typo of one (steamcommunlty.com)
  or a digit swap (st3am.tk) is still marked -- and the badge now says what it saw:
  "Looks like" for a typo or a moved domain, "Uses the Steam name" for the rest.
  Brands that are also ordinary words (steam, apple, chase) on some other domain
  ending no longer count on their own; chase.co.uk is a bank.
- Two markers WardenOne left on every page for no reader are gone: a "protection
  is on" flag that nothing had consulted since the engine's health moved to a
  signed check, and a flag the ad-collapse step set and never read. A page could
  use either only to tell that WardenOne was installed. What remains of that
  surface -- the handles the extension's own parts need, the warnings it draws,
  the events it uses to talk to itself -- is now written down with a reason for
  each, and the gate fails on any new one; the same check proves that knowing
  WardenOne is present buys a page nothing, because every path from the page's
  world into a privileged decision is signed. WardenOne does not promise to be
  invisible, and the README now says so.
- The XSS Behavior Guard costs a page far less per assignment. Every wrapped
  innerHTML, setAttribute, timer or navigation call re-read the page's URL,
  path and window.name, decoded them again, and walked every tag of the value
  before deciding nothing matched; a render loop paid that on every frame. The
  guard now re-reads a source only when it changed, checks whether any source
  text is even present before it walks anything, decodes only a value that can
  decode, and remembers its verdict for a fragment it has already judged while
  the sources stand still. Measured on the shipped code: a benign 8 KiB
  fragment went from 352 to 47 microseconds, a 64 KiB one from 2.3 to 0.26
  milliseconds, and a repeated fragment to about 15; a reflected payload is
  caught exactly as before, and a new URL, name or message is seen at once.
- The anti-fingerprint shield shows a site the same machine every time. The core
  count, memory and GPU it reports were drawn afresh on every page load, so a
  site saw a different computer on every reload and in every tab -- and the
  systems that read exactly those values, fraud checks and "remember this
  device", kept asking you to verify again. The draw is now per site: one site
  always sees one machine, across reloads, tabs and its frames; two sites see
  unrelated ones; and nothing in it is about you, so it links nothing across
  sites. Canvas and audio noise still change per load.
- Eye Shield no longer writes anything into a website's own storage. To paint its
  dark or light backdrop before a page could flash its native colours, it kept the
  chosen mode -- including "off" -- under a WardenOne-named key in every site's
  localStorage, where the site could read it and where it stayed after uninstall.
  The mode now travels inside the extension itself and the page cannot see it;
  the backdrop still paints first. The old key is removed from every site you
  visit with Eye Shield on, and from the open tabs when you switch it off.
- WardenOne's own pages can follow your system's colour scheme. The theme switch
  knew only Light and Dark; there is a System option beside them now, in the
  popup header, the Interface section and onboarding, and it follows a
  mid-session switch. Light stays the default. A chosen theme is also remembered
  for the first paint of the next page, so no page flashes the other theme on
  the way in.
- A failure inside the protection check can no longer switch protections off.
  The routine that applies your settings to the browser -- rules, injections,
  content settings -- kept two spare copies of its list of protections for the
  case where something went wrong, and the copies had drifted: between them they
  forgot Header Shield, both cookie rules, Mail Shield, the search parameters and
  the intranet rules, called six protections with a hard "off", and repeated two
  calls. Had either been reached, an unknown configuration would have been
  answered by disabling protections. There is one list now; when the check
  cannot run, it leaves the browser's state exactly as it was, records that it
  could not run, and the next wake tries again. A single protection that fails
  is reported by name and no longer takes the rest of the list down with it.
- The hidden page that plays notification sounds is closed when it is done. The
  first sound of a session opened it and nothing ever closed it, so a page, its
  scripts and an open audio context stayed resident until the browser closed, in
  exchange for half a second of tone. It now closes a few seconds after the last
  sound -- a burst of notices still shares one page, and no tune is cut short --
  and releases its audio context as soon as the tune has ended. Sound stays off
  by default; nothing changes for anyone who has not switched it on.
- PhishTank lookups no longer announce WardenOne. Every lookup carried an
  `X-WardenOne-Client` header with the exact extension version -- a header
  PhishTank neither documents nor reads -- on a request that already identifies
  you by your own key and the full address, so it only made WardenOne readers a
  separable, build-by-build population for nothing. The header is gone. The one
  request that still carries the version is Google Safe Browsing's, whose API
  requires a client name and version, and the code and the privacy policy now say
  so; a gate check fails if any other request starts introducing the extension.
- The release zip carries only what belongs in an extension. The changelog (95 KiB),
  the security policy and the support note were inside it -- not because a rule
  kept them but because no rule removed them -- and the packaging comment said the
  privacy policy was kept while a rule below excluded it. Each document is now
  decided in writing: LICENSE, NOTICE and CREDITS.md travel with the work, the rest
  are excluded by name, and the package check fails if an unlisted document
  appears or the comment and the rules disagree again. The Store package leaves
  the same two notes out.
- A page can no longer summon WardenOne's redirect warning page for a destination
  of its own. When the in-page guard stops a same-tab jump that followed a real
  click, it asks the worker for the warning page, whose Continue button points at
  the stopped destination -- and that request travelled on the same public routing
  token as every other in-page event, so any script on the site could send one
  with its own landing page as the destination, put it behind a genuine
  WardenOne-branded Continue on a real chrome-extension:// page, and repeat it
  eight times a minute to train you to click through. The request is now signed
  by the guard under a key the page never had, over a number that only moves
  forward and the destination, the reason and the kind the page will show; a
  forged, replayed or altered request raises nothing. The block count on the
  badge is unchanged, and a genuine stopped jump still offers Continue.
- The OpenPhish row in the API keys section no longer asks for a token. The
  community feed WardenOne uses is fetched whole and needs no key, so the
  "Optional OpenPhish token" field stored a secret that nothing ever read -- and
  the only place that said so was the result of a Test button a reader who
  pastes and saves never presses. The field is gone; a token pasted into an
  earlier build is deleted from stored settings on update, along with any other
  saved key this build has no setting for. The keys that are used are untouched,
  and the OpenPhish switch works exactly as before.
- A command picked from the palette runs even when WardenOne's background worker
  went to sleep while the palette was open. The one-use permission the shortcut
  grants lived only in the worker's memory, and Chrome routinely puts the worker
  to sleep within the two minutes a palette stays valid -- so Enter woke a fresh
  worker that knew nothing of the opening, refused, and the palette simply
  closed. Opening now hands the palette a random one-use grant; its hash, tab and
  time are kept in session storage, which outlives the worker's sleep and dies
  with the browser. Nothing was loosened: a pick without the grant, from another
  tab, after two minutes or a second time is still refused.
- A page whose settings request reached a worker that died before answering
  now gets its settings anyway. Every page asked once, at load -- the request
  that wakes a sleeping worker -- and if the worker was reloaded, updated or
  interrupted before it replied, the page ran on WardenOne's compiled defaults
  for as long as it stayed open: a paused or customised site got default
  protections, an enabled one could miss them, and the consent tools, Eye
  Shield, Mail Shield, OAuth Guard and the search marker each either ran on
  defaults or never started. The page's bridge now keeps asking on a short,
  doubling schedule until it is answered, asks again when a page is brought
  back from the cache or made visible, and drops an old reply that arrives
  after a newer one. The other in-page tools ask the bridge instead of the
  worker, so they inherit the retry and usually skip the round trip. Protection
  Health tells "engine running, settings pending" from "verified".
- The corner badge can be pressed again on ordinary pages. It had learned to
  step aside for a control underneath it -- a fullscreen player's exit button,
  a music player's volume slider -- but it stepped aside for ANY link or button
  under it, and on a page with links everywhere something is under it nearly
  all the time. Worse, a badge that has stopped taking input never sees the
  hover that would have made it look again, so on most pages it went dead at
  load and stayed dead until the window was resized. It now yields only to
  things that stay put -- a fixed or sticky bar, a chat bubble, a fullscreen
  player's controls, the flow of a page that does not scroll -- and to those it
  moves up out of the way instead of going dead, hiding only over a player or
  beside a volume slider, as before. Content that scrolls past underneath is
  left to the wheel, as it is under every floating widget. Still driven by the
  same few page events, never by pointer movement or scrolling.
- Scrolling past a Mix or a playlist on YouTube no longer counts a block on the
  badge. The fake-confirm-box guard judges an overlay on its shape, and one of
  its rails was "the affirmative control has no link of its own". A Mix
  thumbnail carries a hover overlay that is exactly that shape -- an
  absolutely positioned, thumbnail-sized box whose only text is "Play all" --
  and the words have no link of their own because the whole card is the link.
  So the overlay was removed on sight and recorded as a block, once per Mix on
  screen, quietly. A control that sits inside a real link now counts as going
  somewhere, which is what it does; a "Play all" box that goes nowhere is
  still removed.
- Anti-fingerprinting noise now covers every frame of a page, not just the page
  itself. The noise rewrites the realm it runs in, and it ran only in the top
  frame -- so a hidden same-origin iframe handed a page a clean canvas, WebGL or
  audio method that worked on the page's own elements, and a third-party frame
  simply measured the real machine and passed the answer up. Child frames now run
  the same noise: a same-origin frame (including about:blank, srcdoc and an
  about:blank window the page opens) inherits the page's verdict and seed the
  moment it is created, before the page can borrow anything from it, so its
  canvas answers exactly as the page's does; a cross-origin frame decides from
  the same switch, the same pause and the same per-site choices as the page
  around it. Captcha frames are left alone, as the sign-in and captcha hosts
  already were. Web workers remain uncovered, and the switch now says so.
- Pages that keep changing no longer keep the three text detectors busy for the
  life of the tab. Scam Lock, ClickFix and Fake Update each re-read the whole
  page after every burst of changes -- about three page-wide passes a second on
  a busy site, indefinitely, with ClickFix forcing a layout each time -- whether
  or not the change contained anything they could act on. They now share one
  scheduler: a change is read for the detectors' own patterns first and buys no
  pass unless it contains one; a page that has not changed is not read twice;
  repeated empty passes space themselves out, up to thirty seconds, and snap
  back to the normal pace the moment a new kind of message, a new route or a
  return to the tab arrives; a hidden tab waits until it is looked at. Nothing
  about what the detectors look for changed, and the clipboard checks stay
  immediate.
- "Flag scraper and content-farm results" works from a fresh install. Its list
  of scraper sites ships inside WardenOne, but the search-page script fetched
  that file itself, and Chrome refuses a content script access to a packaged
  file that is not exposed to web pages -- so the list never arrived, the pass
  quietly switched itself off, and the switch went on reading "on". The worker
  reads the file now and sends the list with the rest of the page's settings;
  nothing is exposed to pages. If the file ever cannot be read, Protection
  Health says so while the switch is on and the Activity Centre gets one entry,
  instead of silence.
- "Clear a site's cookies after accepting" and "Remove a site's service worker
  when you leave" now work after WardenOne's background worker has been put to
  sleep -- which Chrome does inside most visits, about thirty seconds after a
  page finishes loading. Both remembered the acceptance, the registration and
  which site each tab was on only in that worker's memory, so closing the tab
  later woke a fresh worker that knew nothing and did nothing, and logged nothing
  either. The two notes now live for the browser session, bounded and dated, and
  the closing tab's site is read the way Forget Me already reads it. Nothing is
  cleared until the last tab for the site goes, exactly as before; the only
  change is that it happens.
- Pausing WardenOne on a site lets that site ask for your location again. Block
  location requests holds a block in Chrome's own location setting for every
  site, and pausing WardenOne on a map or store-finder site -- or switching the
  block off for that one site -- only paused the page engine; the browser-level
  block stayed, the site was still denied, and the only way to make one trusted
  site work was to weaken Location Privacy everywhere. The block now steps aside
  for exactly the sites you have excused: they get Chrome's own location prompt,
  never an automatic grant, and the exception ends when the pause does (a timed
  pause is now noticed the moment it lapses, which also ends its request-level
  pass on time). Turning the block off now removes every location rule WardenOne
  wrote instead of writing a remembered value over your own per-site choices.
- Twitch playback keeps a healthy alternate stream beyond the old two-minute
  cutoff, avoiding repeated token renewal and stream swaps during an ad break.
  Returning to the native stream now retains its known playlist numbering across
  missing timestamps, network gaps, and temporary playback recovery, and avoids
  blocking requests for translated segment numbers. Repeated intervention-linked
  failures use a bounded cooldown; a brief `playing` event without actual video
  progress no longer re-enables blocking early.
- Twitch ad-service warnings now prepare an alternate without replacing an
  otherwise clean stream. Alternate alignment prefers Twitch's shared broadcast
  sequence when available, avoiding incorrect offsets between session clocks.
  Shortened alternate playlists retain the correct numbers after skipped entries,
  and active native/alternate refreshes overlap instead of spending the fallback
  wait budget on two sequential CDN requests.
- Twitch's worker-owned `MediaSourceHandle` player is now recognized as the
  primary stream. Its empty `currentSrc` previously bypassed intervention-linked
  stall and decode recovery entirely. Recovery remains tied to the exact media
  attachment, so a replacement player does not inherit an old failure.
- The tracker learner no longer keeps a map of your browsing. To decide whether
  to suggest blocking a third-party domain it needs to know that the domain
  turned up on three of your sites in two browser sessions -- but it was
  remembering up to 80 named sites per tracker, with hit counts and exact
  times, and the ids of the browser sessions that saw it, indefinitely. That
  is browsing history under another name, and PRIVACY.md said as much. It now
  keeps a count of sites and a small keyed sketch that can only answer "already
  counted this one?" (dropped once the domain is proposed or decided), a count
  of sessions instead of their ids, dates to the day, and it forgets
  observations not seen for 30 days; your decisions stay. The popup's "seen on
  this site" list now covers the current browser session. Suggestions still
  arrive after the same three sites and two sessions; a coincidence in the
  sketch can cost one extra sighting, never a wrong name. The first start of
  this build folds the old records into counts and the names are gone. And
  Clean browsing data with Browsing history ticked now clears the learner's
  observations and the Script Drift records, which PRIVACY.md had promised and
  the button had never done.
- Calls, recorders and scanners work again with Block camera & microphone on.
  The switch refused every camera and microphone request on any site outside
  a short built-in list -- with a made-up denial, before Chrome could ask you
  -- so Teams, Discord, Zoom in the browser, voice recorders and document
  scanners failed on ordinary sites and blamed your OS permission. It now does
  what its own description promised: a request made while you are actually
  using the page goes to Chrome's own prompt, where you decide; a site you have
  already allowed in Chrome is not second-guessed; and a request a page makes
  with nobody there -- no click or keypress in the last few seconds and no
  standing permission -- is refused as before. Screen capture is never
  pre-authorised: after your click Chrome's picker decides, every time, and
  with nobody there it is refused. Speech recognition follows the same rule.
  The blocked notice now says what happened and what to press. A page that
  asks for the camera the moment it loads -- a pre-join screen after you
  pressed Join on the previous page -- is refused once; its own camera button
  then works.
- Two sites on the same hosting platform are no longer treated as one site.
  WardenOne decided "same owner" from a short built-in list of shared-hosting
  services, so on any platform not on it -- Webflow was the case found -- a
  page on one customer's site and a page on another customer's site counted as
  the same party. That verdict sat in front of the token, card and skimmer
  blockers: a script on one site could send a form's contents to a sibling site
  on the same platform and nothing looked at the request. The same collapse let
  a page force the tab onto a platform sibling with no warning, filed the
  sibling's scripts and requests as first party in the Network Logger and Smart
  Script, and made Forget Me for one site wipe every site the reader was signed
  in to on that platform. WardenOne now carries the private half of the Public
  Suffix List -- the 3,400 shared-hosting and platform suffixes browsers
  themselves use -- generated from the list with its version recorded, and
  every page is told its own site from it. Sites on ordinary domains, and the
  platforms already on the old list, behave exactly as before; the new
  knowledge can only separate what should never have been joined.
- The Network Logger's Clear clears everything, and closing its last window
  keeps nothing. Requests are handed to the page in small batches a fraction of
  a second apart, and a batch already waiting when you pressed Clear could
  arrive afterwards and reappear in the cleared list -- or, if you closed the
  last logger window and opened a new one within that moment, show up in the
  new window despite the promise that nothing outlives the last close. The
  waiting batch now goes with the rest.
- Protection Health now says so if a navigation guard could not start. Five of
  the worker's listeners -- redirect-hop recording, redirect-chain warnings,
  popup tracking, tab-close cleanup and the forced-redirect guard -- were set up
  in one block, so if the first had ever failed to register the other four would
  have quietly stayed off for that browser session while every switch still
  read as on. Each is set up on its own now, and one that cannot start is named
  in the popup's health panel instead of hidden.
- The Activity Centre forgets on a clock. Its log of what WardenOne blocked or
  flagged kept the last 200 events for as long as the profile lived; it now
  keeps them for 30 days at most -- the same period the notification copy of
  those events already had -- pruned on every write, at browser start and daily,
  and Clear history still removes everything at once. The addresses it keeps
  are also trimmed harder: an order, account or phone number in a path, or a
  short token mixing letters and digits, is blanked along with the tokens it
  already blanked. Site, route and reason stay. The privacy policy and the
  Activity page now say exactly what is kept and for how long.
- The daily list refresh downloads each source once. Three lists -- EasyList,
  AdGuard's tracking filter and the Anti-Grabify list -- were fetched twice per
  refresh because two parts of WardenOne read them, and the ten cosmetic-filter
  downloads ran all at once on top of the four blocklist downloads already in
  flight, so up to fourteen multi-megabyte files could be arriving together. One
  download now serves every part that needs it, four downloads run at a time
  across the whole refresh, and the cosmetic lists are fetched after the
  blocklists rather than beside them. Same lists, same checks on them, less
  network and memory while it runs.
- The README's protection counts agree with each other again. One line said 103
  protections have their own switch and another said 104; the code says 104, and
  the build now checks every number printed about protections -- in the README,
  on the site, in the popup and in onboarding -- against the one list they come
  from, and refuses a popup switch that nobody has said what it is.
- The Network Logger no longer keeps anything that could be a secret. It used to
  remove query values only when it recognised the parameter's name, so a
  password in the address itself, a reset token in the path, a card number under
  an unfamiliar name or a sign-in fragment all stayed in the log and in an
  export -- while the page promised they were removed. It now removes sign-in
  details, the fragment, every query value that is not a flag, a small number or
  a plain word, and every part of a path that does not read as an ordinary
  route; a redacted filename keeps its extension so you can still see what kind
  of resource it was. What stays is what you need to write a rule: the site, the
  route and the parameter names. The page and README now say exactly that, and
  that an export is still a list of the sites you visited.
- Page loads cost the background worker far less. Every frame of every page asks
  the worker for its settings and lists as it starts, and the worker rebuilt that
  answer from scratch each time -- reading storage and re-checking every entry of
  four lists that hold thousands of them -- then sent the whole thing, including
  a 5,000-entry list only the search-results marker can use, to every frame. An
  ad-heavy article with thirty frames paid that thirty times over. The answer is
  now built once and reused until a setting or a list actually changes, and each
  script receives only the parts it uses, so a child frame that just needs its
  switches gets a few hundred bytes instead of a quarter of a megabyte.
- Mail Shield now reads its own switch when it starts. It looked for the setting
  under a name the worker never sends, so the check always passed.
- A page can no longer switch the forced-redirect warning off for its own tab.
  When a page throws the whole tab to another site by itself, WardenOne steps in
  with a warning -- unless something in the tab explains the jump, such as your
  click a moment earlier or the in-page guard having allowed that navigation.
  Those explanations reach the background worker as small signals from the
  page, and the check on them was a routing token that page scripts can read,
  so a hostile page could send the "this was allowed" signal itself every couple
  of seconds and keep the warning off indefinitely. The signals are now signed
  with a key handed over before any page script exists, each one counts once,
  and an "allowed" signal names the site it was for, so it cannot be used to
  excuse a jump somewhere else.
- The IP-grabber and cryptominer block lists can no longer be emptied by a read
  that failed. Both are rebuilt every time Chrome starts the background worker,
  from a packaged file plus the copy the daily update keeps in storage, and the
  rebuild used to write whatever it had managed to read -- so if the packaged
  file could not be fetched (which happens while Chrome is updating an
  extension) or storage could not be read, the matching blocking rules were
  deleted, silently, with the popup still showing both protections as on. A
  rebuild now replaces the rules only once every source has been read; if one
  could not be, the rules Chrome is already enforcing are left exactly as they
  are, a warning is logged, and the read is retried a few times over the next
  couple of minutes. Turning either protection off still clears its rules
  straight away.
- EyeShield no longer uses WardenOne's own permissions to fetch stylesheets a page
  chose. To recolour a site's CDN-hosted stylesheets it needs their text, which a
  page cannot read across origins, so it used to ask the background worker to
  fetch them -- and the worker's permissions reach addresses no page may, such
  as a router or a NAS on your own network. A hostname check stood in the way,
  but a hostname cannot tell you where a public-looking name will actually point,
  and Chrome gives an extension no way to find out first. So the request now
  comes from inside the page itself, on the page's own terms: the same
  cross-origin and private-network rules the browser applies to the page apply
  to it, and a page gains nothing it did not already have. Stylesheets on hosts
  that let pages read them (every CDN that serves web fonts does) are recoloured
  as before; a host that does not keeps its own colours, which EyeShield's
  computed-background fallback already covers for.
- Download Shield keeps the redirect chain a download came through, even when
  Chrome put the background worker to sleep in between. The ten-minute record of
  recent redirects is saved to session storage so it survives that, but a worker
  that woke without reading it back would overwrite the saved copy with only what
  it had seen itself -- so the first redirect anywhere in the browser after a
  wake (a link shortener, a login bounce) erased the chain you had just followed,
  and the download that followed was graded without it. The saved copy is now
  read back before it is written, so both halves are kept. Entries still expire
  after ten minutes and the record still holds a digest of each address, not the
  address.
- WardenOne's background worker stops redoing work every time Chrome wakes it.
  Chrome starts the worker for any message, tab event or alarm, and every start
  used to remove and re-add four sets of blocking rules in full (one of them up
  to a thousand rules), tear down and recreate the right-click menu, and list
  every installed extension twice -- whether or not anything had changed. The
  rules are now compared with what the browser already holds and written only
  when they differ, the menu is rebuilt only when its definition or the switch
  that controls it changed (and always after an install or a browser start), and
  the extension check runs once per browser session, with changes still caught
  the moment they happen. Nothing is skipped that could have changed: a rule set
  the browser lost, or a switch that moved, is put right on the next wake.
- My Rules and Custom Lists say which rules are actually in use. The blocking-rule
  band holds 500 across your own rules and every subscribed list; anything past
  that used to be counted anyway and shown as "hiding rules", so 550 blocking lines
  read as 500 blocking and 50 hiding, and the 50 that did nothing were reported as
  doing something else. Overflow is now its own number, each overflowing line is
  named beside the refused ones, the save says "Saved, but not all of it is in use"
  when that is true, and every list row shows its share of the band -- your own
  rules are served first, then the lists in the order you added them.
- The per-site firewall no longer keeps decisions it is not enforcing. It holds 250
  rules across every site; a decision past that used to be stored and drawn as
  yours while never becoming a rule, and which ones ran depended on the order they
  were made in. A decision that would not fit is now refused with the count and
  nothing is stored, and any cell stored before this that has no rule behind it is
  drawn struck through and counted as not in effect.
- Protection Health no longer calls a count of switches "Active shields", and no
  longer says "You're safe" without checking the page in front of you. The
  number is labelled "Switched on" -- that is what it is. The panel now asks the
  tab the popup is open on whether the in-page engine answers its signed check,
  the same question Verify & Repair asks, and shows the answer on its own line:
  engine verified, engine missing, paused on this site, not injected here, cannot
  be checked (a browser page), or not confirmed yet. "You're safe" is said only
  when that page verified and nothing else is wrong; otherwise the headline is
  "Protections on" and the detail says what could be checked and why the page
  itself could not. A page that has not answered yet, or that Chrome keeps
  extensions out of, lowers nothing -- only an engine the page's own bridge
  reports missing does.
- Turning Silent mode off brings your toasts and badge back. Silent used to be
  written into those two switches -- the popup unchecked them while Silent was on
  and saved them that way -- so turning it off left both off until you found and
  re-enabled them yourself, and Silent chosen during onboarding, which wrote only
  the one setting, silenced nothing. Silent is now a gate over what the page shows,
  applied to the copy of your settings the page receives; the switches underneath
  keep your choices and are greyed while Silent is on. A profile the old popup
  had already left with both switches off gets Normal back the next time Silent
  is turned off.
- Memory Shield's five-minute sweep could be postponed for as long as you kept
  browsing. Every time Chrome started the extension's worker -- which a navigation
  or a message does, many times an hour -- the sweep alarm was created again, and
  Chrome treats that as cancel-and-replace, so the sweep moved another five minutes
  away each time and on a busy session never came round. The alarm Chrome already
  holds is read first now and kept; it is created only when there is none, or when
  its period has changed. Turning Memory Shield off still clears it at once.
- Four network protections could switch themselves off without anyone asking. The
  DNT/GPC request headers, location-header minimisation, tracking-cookie stripping
  and Force HTTPS were each refreshed by clearing their rule with one call and
  installing the replacement with a second; Chrome ends a service worker whenever
  it likes, and a worker that died between the two left the setting saying "on"
  with no rule behind it until the next browser start. Each rule is now replaced in
  a single call carrying both the removal and the addition, which Chrome applies as
  one transaction, and Force HTTPS refreshes its persistent copy first and its
  session copy second so neither store is ever empty while the setting is on. A
  new suite reads every rule update in the worker for the two-call shape and models
  a worker death after each call.
- Search-result warnings now actually appear. Three things had silenced them
  everywhere: DuckDuckGo puts an empty results container before the one its
  results live in, and only the first was ever read; Bing and Yahoo hand out
  every result through their own redirect link, so each result looked like the
  search engine itself; and Bing quietly deletes anything added inside a result,
  so the line vanished within seconds of being drawn. Every results container is
  read now, the destination is read out of the engine's redirect, and the line is
  drawn by the stylesheet on the result itself, where nothing can remove it. A
  search made while WardenOne is still downloading its lists after install is
  asked again once they are in, instead of being remembered as clean. The line is
  a symbol and a sentence in the page's own text above the result, not a red bar,
  one per result even when Google nests a block per sitelink, and it says what
  the site is: an IP logger is called an IP logger, not "malware and scam", even
  when it is on those lists too. The search engine's own links are never marked.
  The line also arrives with the results now instead of most of a second after
  them: the packaged IP-logger list travels with the page's own script, so a
  known logger is named before the background worker is even asked, the worker
  answers with what it already holds rather than waiting for its lists to reload,
  and the page draws that answer the moment it lands.
- Stopped pages that describe ClickFix being warned about as if they were one.
  The instruction reading matched the words alone, so a security write-up or
  WardenOne's own GitHub page -- which explains the trick in a paragraph -- got the
  "verification steps look like a ClickFix scam" panel on every visit. A lure lays
  its steps out as interface, one short line each; a description buries them in a
  paragraph, usually in quotation marks. The text-only warning now needs the
  lure's shape. What a page puts on the clipboard is still judged by reading the
  command, whatever the page around it looks like, and is still blocked.
- Stopped pages that merely talk about notification scams being reported as
  notification bait. The check read the words alone, so a security write-up, a help
  page or WardenOne's own GitHub page ("coaching you to press Allow") was flagged on
  every visit. The warning now needs the page to have actually asked for the
  permission -- through the notification prompt or a push subscription -- and it
  comes the moment it asks, including an ask made at load before WardenOne's
  settings have arrived.
- Fixed YouTube tabs intermittently showing every Google account as signed out
  while a reload or fresh tab immediately restored them. The child-frame
  credential guard trusted Google's identity hosts but not the YouTube service
  family they refresh account state into, so it could reject a legitimate
  token-bearing account refresh in the live page. Google and YouTube account,
  image and video destinations now share the same established-family exemption
  already used by the top-frame guard; unrelated and lookalike destinations are
  still blocked.
- Fixed the two filter-list builders refusing to run at all. Both carried a `#!`
  line under their licence header, and that only works as the very first thing in
  a file, so `node tools/build-adshield-dnr.js` stopped on a syntax error before
  it did anything. This affected rebuilding the ad and tracker lists from source;
  the shipped lists were never wrong. The repository gate only ever parsed the
  test scripts, which is why it never noticed — it now parses every script in
  that folder, so the next one cannot hide either.
- Fixed Spotify's volume slider feeling choppy and continuing to catch up after
  the pointer stopped. Its hidden native range control reaches into the same
  bottom-right area as the Guard Active chip, while every drag update also used
  to wake the consent-banner scanner for a full-page layout pass. The badge now
  gets completely out of the way of nearby player controls and never hit-tests
  from pointer-move events; its nearby-control check no longer silently fails in
  strict mode, and a hidden badge keeps enough geometry to remain hidden on later
  checks. Spotify is now treated as a trusted player surface, so the overlay
  cleaner no longer reclassifies hundreds of player nodes while its controls
  update. The consent observer no longer watches per-frame inline-style feedback,
  ignores mutations unrelated to consent UI, stops once a reject/save choice has
  completed, and moves its remaining scans out of active frames. Meta-refresh,
  selector-only ad cleanup, login-age, form and script-drift checks now ignore
  unrelated slider-only DOM churn as well, while text-dependent ad rules stay
  coalesced. After its four-second check, player recovery uses bounded, throttled
  element-only follow-ups instead of measuring rendered text while a slider moves.
- Fixed Element Zapper trapping clicks meant for its own Keep, Undo, Done and
  Cancel controls. Zap now saves one selection, pauses further picking, reports
  save failures honestly, and keeps its confirmation open until Done; oversized
  selections have clear Hide anyway and Cancel choices. Saved elements are
  replayed independently of AdShield, remain visible and reversible in the popup
  even through parent-domain inheritance, and stay undoable with Ctrl+Z after
  Done without taking Ctrl+Z away from text fields and editors. The Zapper is now
  a searchable setting, its current-site list is a collapsed dropdown, and a new
  local manager groups every saved zap by site with search and individual Undo
  controls that update matching open pages. Its decorative emoji were removed.
- Fixed shared hosting platforms being mistaken for one site. GitHub Pages,
  Netlify, Vercel, Cloudflare Pages, S3-style storage and other multi-tenant hosts
  now keep tenant identities separate across allowlists, trusted destinations,
  learned rules and per-site cookie controls. Platform-apex blocklist mistakes are
  still ignored without making every tenant unblockable.
- Private windows now run in a split extension context, keep site-permission changes
  session-only, and refuse durable history, learned-domain, reputation, breach,
  script-baseline and site-trust writes. Paused-download review state stays available
  for recovery within the private session without surviving it. Private activity also
  cannot prune or timestamp the regular profile's extension storage.
- Fixed the isolated engine watchdog and navigation-attribution relay being rejected
  by the service worker's tab-message allowlist before their handlers could run. The
  watchdog can now restore a page-disposed MAIN-world engine, while redirect decisions
  once again receive the user and player gestures used to distinguish intended travel
  from a frame-driven tab hijack.
- Rebuilt Extension Watch around a versioned local inventory. It now records new
  installs, version-only updates, permission and host-access changes, enable/disable
  changes and removals; a 15-minute local reconciliation catches events Chrome did
  not deliver. One shared capability classifier explains combinations such as broad
  site access plus cookies or script injection. Harmless updates stay quietly in the
  timeline, important changes remain unread until explicitly reviewed, notification
  clicks open the review surface, failures are visible, and every change also reaches
  Activity Center. The first inventory is still a quiet baseline, not a mass warning.
- Expanded Download Shield's publisher routes with additional official operating-
  system, security, utility and game-vendor domains. Vendor delivery routes that sit
  on shared AWS, Azure, Akamai and similar infrastructure are trusted by exact host
  only, so the real installer stays quiet without trusting an attacker's sibling
  tenant. Filename disguises, malicious Chrome verdicts and risky redirect chains
  continue to override every publisher exception.
- Download Shield no longer treats a low-prevalence URL or an incomplete Chrome scan
  as enough evidence to interrupt a safe document. Those labels now support a real
  file, source or filename concern instead of crossing the review threshold alone,
  which stops one-off exports from web apps being called risky merely because every
  generated link is new. Claude, Anthropic and Claude's separate user-content host
  are recognised explicitly; the user-content host receives only limited platform
  trust, and executables, password-protected archives, disguised names, blocklist hits
  and Chrome's known-malicious verdicts still surface in full.
- Fixed a site being blocked for handing you a file. A page sending the tab to another
  domain to deliver a download was treated as a hijack and covered with an interstitial,
  so you got neither the file nor a reason. The guard exists to stop the tab being sent
  somewhere you did not ask to go, and that does not happen with a download - Chrome
  turns the navigation into a download and the page you were on stays where it is. What
  the interstitial actually stopped was the file, and whether a file is safe to have is
  Download Shield's decision: it grades every one, blocks the known-bad and holds the
  risky for a review you can cancel, with the reason attached. A download destination is
  now handed to it rather than blocked here. Only while Download Shield is on - with it
  off there is nothing to hand the decision to, so the old behaviour stands. A page
  merely *called* `/download` is not a file and is still caught.
- Fixed the same warning appearing several times over. Repeat suppression keyed on what
  triggered a warning rather than on what it said, so a page loading five trackers
  produced five cards with the same title, the same explanation, the same severity and
  the same advice, differing only in the small host printed underneath. That is one
  warning shown five times. Warnings are now identified by their wording, so the same
  one appears once per page however many things set it off; every occurrence is still
  listed in the Activity Center. Warnings that genuinely differ still each appear, and
  ones arriving at the same moment are now spaced out instead of stacking - the guard
  meant to do that had a condition that could never be true, so it had never once run.
- Fixed the scroll lock being left on after a fake confirm box was removed. The
  release only cleared an inline `overflow`, which a live sweep of full-screen
  overlays found is the one form the lock almost never takes - it is normally a class
  on `<html>`, where there is no inline style to clear, or `position: fixed` on the
  body, which takes the page out of flow and collapses it to a single screen. Either
  way the box vanished and the page stayed frozen. It now removes the lock class,
  falls back to clearing inline styles and then to overriding the stylesheet, checks
  after each step by actually trying to scroll, and puts you back at the position the
  box had parked you at.
- Added clearing cookies after you accept them. Turn it on and any site where you
  accept a cookie banner has its consent and tracking cookies cleared again once
  you leave - when its last tab closes or you navigate away. It uses the same rules
  as the manual cleaner, so it cannot sign you out: only known consent and tracking
  cookie names are touched, never the whole site, and anything it does not
  recognise is left where it is.
  The tracking IDs a site keeps in localStorage go with them, which is where most
  measurement moved once third-party cookies started dying. That is also where most
  sites keep the session token, so it works by vendor namespace rather than by
  pattern: a key goes because it belongs to a company whose business is measurement,
  not because it looks tracker-ish. Names like _hjSessionUser and _uetsid read as
  credentials and are cleared anyway, because the namespace is known; anything
  called analytics_opt_out or tracking_id is left alone, because it is not. Two
  vetoes override even a known vendor - a value shaped like a JWT is a credential
  whatever its key says, and anything over a kilobyte is application state rather
  than an id. Off by default.
- Fixed cookie banners offering "Required cookies only" not being answered.
  The matcher wanted the word "only" directly beside "necessary", "essential" or
  "required", so "Only required cookies" was recognised while "Required cookies
  only" - the more common wording - was not, and the banner stayed up.
- Fixed pages throwing you off the site you asked for. A page could send your whole
  tab to an ad network without you touching anything, and where it lands is
  auctioned per visit, so blocking by destination never held for long. WardenOne now
  stops the jump itself: if a page moves the tab and you clicked nothing, you get a
  warning with the choice to continue. Sign-in redirects, link shorteners and
  anything you typed or clicked yourself are unaffected.
- Fixed forced redirects that no in-page check could see. An embedded frame can move
  the whole tab, and a redirect that happens before the page is delivered leaves no
  page to run a check in. Both are now caught outside the page, and a chain that
  ends somewhere other than the site you asked for is recorded even when it is short
  and clean.
- Fixed fake confirm boxes. A page can draw its own dialog - "Please confirm to
  continue", "The file is ready to download", an OK button - to collect a single
  click, which it then spends on opening a popup or moving your tab. These are
  removed on sight, quietly. A real dialog says what you are agreeing to, so
  anything naming a price, a file, an account, an age or a password is left alone.
- Fixed floating ad frames, judged separately because they impersonate nothing -
  just a graphic with an INSTALL badge. What marks them is the frame: built by
  script, no address of its own, sandboxed to allow popups. Anything loaded from a
  real address, including payment forms, captchas and players, is left alone.
- Fixed a box demanding you click Allow to see the page. It called itself an age
  check, which is the one subject the rules protect, but a real age gate has no
  reason to mention the browser's own permission button. A site asking for
  notifications honestly, without holding the page hostage, is untouched.
- Added fwpixel.com and dv.tech to the tracker list. Both turned up beaconing during
  a survey of twelve sites and were on none of the shipped lists. DoubleVerify is ad
  verification, so if a site's video stalls rather than skipping an ad break, that is
  the entry to remove.
- Fixed the allowlist not covering the redirect guard. It is a separate all-URLs
  content script and was handed the raw toggles rather than the allowlist-gated ones,
  so allowing a site left forced-popup, gestureless-navigation and meta-refresh
  blocking running there anyway.
- Fixed the session-security grade being harsher than the evidence. The cookie audit
  asked for cookies on the exact hostname while session cookies are set on the
  registrable domain, so a site with an obvious session cookie was graded as having
  none - which also skipped the only part of the score a site could earn points in.
  A session readable by scripts was also charged twice when the same token appeared
  in both storage and a cookie, and the storage penalty alone was enough to drop an
  otherwise-clean site two grades.
- Fixed uploads hanging on "sending" instead of failing. A blocked request called
  `abort()` in place of `send()`, and that fires no events at all, so the page waited
  forever for a result that was never coming.
- Fixed attaching a file to a Microsoft Form being blocked. The token guard's
  Microsoft family listed only the sign-in and mail hosts, not the storage endpoints
  Office actually uses.
- Stopped ClickFix warning on install commands published by the projects that own
  them. A script project putting "run this in PowerShell" beside its own installer
  is the same shape as the attack, so the publisher now matters.
- Stopped OAuth Guard warning about a provider signing you in to its own app.
  GitHub CLI, GitHub Desktop and Codespaces use the same authorize page as anyone
  else, and being asked to approve GitHub to GitHub is not a phishing signal.
- Stopped the XSS guard reporting ordinary data. A value now has to be shaped like
  code or markup *and* land where code actually runs; a query parameter appended to
  a script URL, a `srcdoc` set through `setAttribute`, upload and OAuth navigation,
  short message values, quoted script strings and escaped examples no longer count.
  Weak evidence also names where it came from rather than calling everything
  "message data".
- Fixed the XSS guard reading its own bridge messages through its own instrumented
  getter, which could make unrelated page messages look attacker-controlled.
- Kept separate tenants on shared hosts - `github.io`, `pages.dev`, Netlify, Vercel,
  Cloudflare Workers, Firebase and S3/CloudFront - on distinct `postMessage` trust
  boundaries, so one tenant is not trusted as another.
- Rebuilt Activity Center detail for XSS, behavioral-risk and ClickFix events from
  values the background owns rather than anything the page can forge, and stopped
  those events teaching the automatic blocklist.
- Warnings now stay on screen long enough to read. Every card used to be dismissed
  after a flat five seconds whether it said "Popup blocked" or carried four lines of
  explanation, so the ones worth reading were the ones you could not finish. Each
  card now gets time measured from its own text, reviewed on screen one at a time.
  Popup save errors are no longer cleared before the message can be read.
- Fixed the "Guard active" badge. It announced itself for four seconds on every page
  load, sat at a different distance from the edge depending on whether the page had
  a scrollbar, and could be moved or restyled by the page itself.
- Fixed popup search collapsing EyeShield into a lone, malformed Dark button.
  EyeShield now appears as one complete result with all four modes and its controls.
- Restyled the **This site** controls to use the popup's established section
  heading, card spacing and stacked action layout.
- Serialized Header Shield rule updates so fast toggle changes cannot leave stale
  rules behind. Client Hint, strict referrer and cache-validator protection still
  preserve top-level, sign-in and payment paths.
- Restored the exact pre-dark-mode light palettes, gradients, translucent panels,
  warning colours and shadows on every full-page screen. Shared surface overrides
  are now dark-only, so the dark theme layer cannot alter the light design.

- Made GitHub's default Latest release follow the rolling, gate-passing `main`
  package, and pointed repository and website download buttons directly at it.
  Current builds no longer require a version bump just to become downloadable.
- Shortened blocklist-update ages in the compact protection-health tile so the
  value no longer clips inside the popup.
- Updated Twitch's clean-stream search to the currently effective identity order:
  `mobile_feed/android`, `popout/web`, then `autoplay/android`. Every compatible
  rendition is checked, so one stitched quality no longer discards a clean rung
  from the same Twitch-signed session.
- Re-anchored alternate Twitch playlists onto the player's existing
  `MEDIA-SEQUENCE` timeline using `PROGRAM-DATE-TIME`. This removes the accumulated
  sequence hole that could leave a stream farther behind after every ad break or
  buffering until a manual pause/unpause.
- Rejects ended, undated, backward, and stalled alternate playlists; ignores
  out-of-order native responses; deduplicates the worker's initial master; and
  invalidates in-flight work on channel/config changes. Clean identity and
  rendition probes are staggered concurrently so a slow first route cannot consume
  the whole pre-roll or mid-roll deadline.
- Declined Twitch display ads through its own page AdManager and denied
  picture-in-picture playback tokens locally without breaking mixed GraphQL
  batches or replaying them after an error. XHR ad-service calls now remain native
  instead of throwing from `open()`, while existing fetch/GraphQL no-fill handling
  remains as a compatibility fallback.
- Removed Twitch's HLS-gap, native cover/mute, pause/play, and page-seek fallbacks.
  If Twitch supplies no clean local session, WardenOne now leaves native HLS and
  LL-HLS media intact so the player keeps advancing instead of entering a hidden
  ad loop or starving its decoder.
- Refreshes an already-cached clean Twitch playlist as soon as Twitch warns that
  an ad is imminent, reserves that one-shot result for a request that begins after
  the warning, and briefly reuses it if the ad poll lands just afterward. Twitch's
  narrowly identified "allow ads / get Turbo" house overlay is also hidden from
  startup instead of waiting for the playlist handoff. This targets the remaining
  one-to-two-second flash without adding segment blocking or continuous background
  polling.
- Counts media segments represented by `EXT-X-SKIP` in Twitch low-latency delta
  playlists. A standards-compliant abbreviated refresh can no longer look older
  than the preceding full window and bypass the clean warning-time handoff;
  malformed or duplicate skip metadata fails open byte-for-byte.
- Restored Twitch's native primary playback identity and limited clean-stream
  swaps to the player's exact resolution, frame rate, codec profile, media groups,
  HDR range, and container. A sustained source-quality rendition can no longer be
  stolen by one lower-quality probe, while cached refresh and full-search work now
  share one real serving deadline. If a clean route is still finishing, one fresh
  marker-free native window bridges the break once and the late result is reserved
  for the next poll, avoiding the short substitute-ad flash without a replay loop.
- Prevents a frozen Twitch alternate playlist from becoming fresh again merely by
  reacquiring the same consumed media window. The worker now falls back to the
  advancing native stream, and four seconds of intervention-linked buffering opens
  one bounded native recovery window without pausing, seeking, restarting, or
  reloading the player; stable playback restores interception early. Recovery is
  scoped to the exact channel and MediaSource, and a channel, source, or setting
  change cannot carry an old stall timer into the next stream.

## 1.0.0 — 2026-07-29

First public-release hardening pass.

### Fixed

- Warnings no longer repeat themselves. The same popup could come back every
  second or so for as long as a page kept doing whatever set it off, which is how
  you learn to dismiss a warning without reading it. Each distinct thing now warns
  you once per page. Two different problems still get a warning each, and
  reloading or moving to another page starts fresh.
- Stopped warning about trackers that had already been blocked. WardenOne watches
  what a page tries to do and separately blocks the request itself, and the two
  were not comparing notes -- so you could get "Possible tracker" about a request
  that never actually left your browser. It now stays quiet when the block has
  already done its job, and still speaks up for anything it does not recognise.

- The privacy cleaner now also clears data sites leave in the File System API,
  which it was clearing everywhere else in WardenOne but not here.
- When cleaning fails, the cleaner now tells you what went wrong instead of just
  saying to try again.

- Download Shield no longer calls ordinary installers dangerous. It scored the word
  `setup` exactly the same as the word `keygen`, so an honest `MyApp-Setup.exe` from a
  small vendor's own site came up as "Dangerous" -- the one warning level with no
  Continue button. That is the most common installer filename on Windows. The two kinds
  of word are told apart now, and the words that really do mean trouble are no longer
  watered down by sharing a list with the word every honest installer uses.
- Files whose names merely contain a worrying word are left alone. `firecracker.exe`
  and `nutcracker-setup.exe` were flagged because they contain "crack", and every
  serial-port tool was flagged because "serial" is an ordinary English word. Both
  checks now look for whole words.
- A file served with a vague content type is no longer treated as a disguise.
  `application/octet-stream` just means "some kind of file" and a great many servers
  send it for everything they have, so an ordinary PDF from such a server was shown as
  High Risk -- and, worse, it overrode the trusted-publisher check, so even a PDF from a
  well-known company was pulled out of quiet. The same applied to a `.js` file served
  as JavaScript or a `.ps1` served as text, which is simply the correct type for those
  files. A genuinely disguised name is still caught.
- Your own network is not treated as a stranger's server. An installer on the office
  file server or the box in the spare room was charged for being on a bare address and
  for not using HTTPS -- neither of which means much on your own LAN -- and landed at
  "Dangerous". A disguised file on your network is still caught in full.
- Disk images and macro documents get the same benefit of the doubt as programs. A
  Linux ISO from a community mirror and the spreadsheet your finance team sends every
  Monday were both shown as High Risk with nothing else against them.
- A download saved straight out of a web app is no longer treated as coming from
  nowhere. Password-manager exports and files a site builds in the page were shown with
  "(unknown)" as their source and charged for it.
- Small honest projects on cheap domain endings are not condemned for the ending alone.
  It still counts against a file when there is something else wrong.
- "Always trust this site" now trusts the site you meant. On a shared hosting service it
  was handing over every site on that service, and on a bare address it offered to trust
  a meaningless fragment of the number. It is also offered on one more warning level, so
  a file you get every week can be remembered instead of warned about every time.
- The warning level called "High Risk" is now called "Unverified Source", which is what
  it actually means: WardenOne could not work out where the file came from. Calling that
  High Risk is what made the real "Dangerous" easier to click past.
- A warning that opens while Chrome is still checking a file now goes away by itself
  when the answer comes back clean, instead of sitting there worrying you about a file
  that has been cleared.
- Turning on a VirusTotal key no longer sends the private parts of a download link.
  Addresses on your own network, and the sign-in tokens that live in the tail of a
  download URL, were being sent along with it -- even for files that were never shown to
  you.
- One antivirus engine out of about seventy disagreeing about a well-known company's
  installer can no longer drag it from silent to "Dangerous". It can still say so.
- Adding a key now works in both directions. Until now every check could only ever count
  against a file, so paying for a key bought you more interruptions and never fewer -- a
  file that seventy engines had looked at and cleared scored the same as one nobody had
  ever seen. A clean result, and a domain that has belonged to a named company for years,
  now count in a file's favour.

- Stopped a tab that stays open across an extension update from running two copies
  of the protection at once. Chrome does not re-inject into tabs that are already
  open when the extension updates, so the old copy carried on -- its observers
  watching every change the page made, its timers still waking, its listeners still
  firing -- while the new copy installed alongside it. Both were charged for the same
  work, on exactly the tabs left open longest. The new copy now releases the old
  one's observers, timers and listeners before it installs.
- When storage gets tight, WardenOne now throws away the things it can simply fetch
  again before it touches anything of yours. It used to trim only your blocklist, your
  history and one feed, leaving every rebuildable cache untouched -- including the
  filter data that is the largest thing it stores. So it could finish tidying up and
  still be full, while the write that failed stayed failed. It now clears the lookup
  caches and filter data first, checks whether that was enough after each step, and
  stops as soon as it is. Your history and blocklist are only trimmed if freeing
  everything disposable was not enough.
- The block count on the icon no longer falls back to 1 while you are reading a page.
  Chrome puts the extension to sleep after about thirty seconds of quiet and the
  running total went with it, so the next thing blocked on a busy page reset the number
  to 1. It now reads the number already on the icon and carries on from there.
- Memory Shield works again on sites you have used for a while. It refuses to sleep a
  tab holding text you have not saved, which is right -- but it decided that from the
  first key you pressed in any box, including a search box, and never changed its mind.
  On sites that never fully reload, one keystroke exempted the tab for the rest of the
  session, so the feature quietly did less the more you used the browser. It now looks
  at what is actually in the page when asked. The same applied to the camera and
  microphone check: stopping a call did not clear it, and now it does. A tab with
  genuinely unsaved typing is still protected, and anything uncertain still counts as
  unsaved.
- Made pages with several filter rules of one kind stop paying for each of them. Some
  filter lists carry more than one rule that strips junk out of the data a site loads,
  and WardenOne was hooking that data path once per rule -- so a site matched by four
  rules had its data checked four times over, on a path nearly every modern site uses
  constantly. It hooks once now and applies all the rules in a single pass, with one
  budget for the whole pass instead of one per rule. YouTube and Twitch were already
  excluded from this and still are.
- A site can no longer delete WardenOne's warning about itself. The three warnings --
  a script changing under you, a chain of permission requests, and a login page on a
  domain that is only days old -- were ordinary elements in the page, so the site being
  accused could remove the accusation. They now live somewhere the page cannot see or
  touch, and put themselves back if they are removed. WardenOne's own overlay cleaner
  was also able to remove them, which is fixed too: it now leaves anything belonging to
  WardenOne alone, however it was added.
- Closed a way a website could switch its own cookies back on. When WardenOne stops a
  site from reloading itself forever, it offers you a button to allow that site's
  cookies. WardenOne used to find its own button by looking for its shape, and a site
  can build the same shape -- so a site could put up a lookalike, label it "Play
  video", and one ordinary click of yours would have allowed its cookies. The button
  now lives somewhere the page cannot see or copy, and WardenOne acts only on a click
  on the button it built itself. What a site could reach was always limited to its own
  cookies; it could never touch another site or any other permission.
- Verify & Repair can now actually re-arm a tab, instead of only being honest that it
  could not. Every part of the protection refuses to install twice, which is correct --
  but the check was a plain yes/no, so a tab still holding an abandoned copy from
  before the extension reloaded refused the fresh one and nothing changed. Each part
  now records which version it is, Repair tells the abandoned copies they have been
  replaced, and they hand back the listeners, watchers and timers they were still
  running before the new copy takes over. Tabs open across an update get the same
  treatment automatically.
- Stopped Verify & Repair claiming it fixed tabs it had not. It counted a tab as
  re-armed whenever it managed to send the protection code, but a tab still
  running an older copy from before the extension reloaded quietly refuses it --
  which looked identical from the outside. It now asks each tab what it is
  actually running and whether that copy can still reach the extension, and says
  so: tabs it genuinely re-armed, and separately, tabs that need a reload. The
  check no longer passes while any tab still needs one.
- A busy chat is no longer mistaken for a tech-support scam. WardenOne watches for the
  shape those scams have -- a page that frightens you, and then tells you to call
  someone or install something -- but it was looking for those two halves anywhere on
  the page at once. On a live chat they can arrive from two different people, minutes
  apart, talking about nothing in particular: somebody worrying about their data, and
  somebody else posting a giveaway code. That was enough to put a full-screen warning
  over a stream you were watching. The two halves now have to appear together in the
  same passage, and on video and chat sites, where everything on the page was typed by
  somebody else, the check does not run at all.
- EyeShield no longer flattens everyone in a chat to the same colour. When text was too
  faint to read against what is behind it, EyeShield repainted it one safe colour. That
  is right for text that is merely hard to read, and wrong when the colour *is* the
  information -- on Twitch every person in chat has their own, and all the darker ones
  came out identical, so you could no longer tell who was speaking. It now keeps the
  colour it was given and lifts its brightness until it is readable, so names stay as
  distinct as the site meant them to be. Greys have nothing to preserve and are still
  repainted.
- Dismissing a WardenOne warning now puts the keyboard back where it was. Three of the
  warnings closed by hiding themselves rather than by shutting down properly, so the
  panel vanished and looked closed while the page was still being told a dialog was
  open -- and whatever you had selected before it appeared never got the cursor back.
  If you were reading with a screen reader or working without a mouse, you were left
  with nothing focused and a page that still claimed to be behind a dialog. All five
  warnings now close the same way.
- A warning can no longer get stuck on screen when WardenOne restarts underneath it.
  Pressing Verify & Repair reloads the protection in every open tab, and a warning that
  happened to be on screen at that moment lost every one of its buttons: it stayed
  covering the page, kept the keyboard inside itself, and nothing would close it short
  of reloading the page. Since Repair is the thing you press when something already
  looks wrong, it was most likely to happen exactly when a warning was showing.
  Restarting now closes any warning it is replacing, and hands the keyboard back first.
- Smart Script Shield can now recover a page it has blanked. Plenty of sites serve their
  own code from a second address, which the shield reads as third-party and refuses --
  and then the page never paints at all. It could already spot and undo this on video
  pages, because that is where it was first found, but an ordinary page that came up
  blank had no way back: it just stayed blank. A blank page is now the same signal a
  blank video player already was. Nothing is taken on trust — the extension still only
  acts where it independently saw a script of its own refused on that exact page, it
  relaxes the rule for that tab alone, and it still refuses to un-block anything known
  for tracking or fingerprinting.
- The adult-site warning no longer appears on a search results page, or on any page that
  merely mentions the subject. It scored a page partly on its address and partly on its
  title, but the title alone was enough to reach the threshold — so searching for an
  explicit word put the warning over the results, before you had gone anywhere, and a
  news article or forum thread about the topic could trigger it too. Pressing "take me
  back" from a results page then returned you to the search engine's home page, which is
  what that looked like from the outside. The title now only strengthens what the address
  already suggests, and a search results page is never treated as the site being searched
  for.
- Choosing to continue past a full-page warning gives you the page back. The warnings
  that cover the whole window — the adult-site gate, the redirect-chain and IP-logger
  notices, the phishing block — work by hiding everything on the page and drawing
  themselves on top. Dismissing one removed both halves, but the check that puts the
  warning back if a site tears it off could still run a fraction of a second later, see
  both halves missing, and put the hiding half back on its own. The result was a black
  page that never recovered, with whatever the site wanted to show you still there
  underneath, invisible. The page-hiding half can now only exist while the warning
  itself does, so there is no longer a state where one outlives the other.
- WardenOne now credits every list it uses, not just the best-known four. It draws on
  37 community blocklists from 21 projects, and only four were substantively credited --
  not from any wish to hide the rest, but because a hand-written attribution page falls
  behind the moment a list is added. The credits page now has a table generated from the
  code itself, so it cannot drift, and the release check refuses to pass if a list is
  added without one. Where a project's exact terms have not been confirmed yet, it says
  so rather than leaving a blank.
- A site asking for notification permission is now recorded once rather than twice. The
  browser can answer that request through two different mechanisms at the same time,
  and WardenOne was logging both — so one prompt appeared as two entries in your
  activity log and used up twice its share of the limit that keeps this cheap.
- The breach-history check now gives up instead of hanging. It had no time limit, so a
  server that accepted the connection and then said nothing left the button greyed out
  and the panel reading "Checking…" for as long as the connection stayed open. It now
  stops after eight seconds and says the database took too long, which is a different
  thing from not being able to reach it and now reads that way.
- Deep cryptominer detection no longer reads a whole file to look at the first part of
  it. It only ever examines the first 800 KB of a worker's code, but it was downloading
  all of whatever it was given before trimming, so a page could hand it something
  enormous. It now stops reading at the limit. It also ignores error pages rather than
  searching them for mining terms, and no longer starts a second read of a file it is
  already reading.
- A download WardenOne paused can no longer be left paused with nothing to explain it.
  When it holds a file for you to look at, it saves a record of the review -- but two
  downloads arriving at once could each save their own copy of that record over the
  other, so one of them was left paused in Chrome with its review panel closed and
  nothing offering to resume or cancel it. Those records are now written one at a time.
  On top of that, WardenOne now checks on startup for anything it paused that has no
  review attached, and puts the review back. It never resumes a file on your behalf.
- Updating the extension no longer closes a download review you were in the middle of.
  Chrome updates extensions quietly in the background, and WardenOne treated that as
  though you had restarted your browser -- so a file you started downloading minutes
  earlier was written off as belonging to a previous session, and its review was cleared
  away while the file stayed paused. Only a real browser start counts as a new session
  now.
- Protections that read a saved list now wait for it to load before deciding anything.
  Chrome shuts the extension down whenever it is idle and wakes it the moment something
  happens -- it does not wait for WardenOne to finish reading its files first. So the
  first thing to happen after each of those many restarts was judged against empty
  lists: a download from a site on the blocklist scored as though it came from nowhere
  in particular, and a redirect through a known-bad domain was not marked as one. Worse,
  anything WardenOne learned in that gap was then wiped out when the file finally
  loaded, and the file itself was overwritten with only that one entry. Everything that
  depends on those lists now waits for them, and loading merges with what is already
  there instead of replacing it.
- Forget Me no longer misses a tab that closes just after a restart. It remembers which
  site each tab was on so it knows what to clear when you close it -- Chrome does not
  say, and once the tab is gone there is no way to find out. That memory was lost on
  every restart, so a tab closed in the moment before it was rebuilt was simply never
  cleared, and a tab you had navigated somewhere new could have the wrong site cleared
  instead. It is now kept somewhere that survives, and a slow rebuild can no longer
  overwrite a page you visited while it was happening.
- Warnings that look at several things together stop losing their place. The permission
  chain and the "this download arrived through a redirect" check both work over a
  ten-minute window, and both kept that window only in memory -- which Chrome empties
  far more often than every ten minutes. The same sequence of events could be a single
  clear warning or two unrelated shrugs depending on nothing but whether the extension
  happened to be asleep in between. Both windows now survive that.
- A setting you just changed can no longer be undone by one you changed a moment
  earlier. WardenOne keeps your settings and its filter data in memory so it does not
  re-read them for every frame of every page, but a read that was already underway when
  you changed something could finish afterwards and write the old values back over the
  new ones -- and then keep serving them. Turning WardenOne off, or adding a site to
  your allowlist, could quietly revert and stay reverted. Reads that started before a
  change now answer whoever asked for them but are no longer allowed to replace what
  came after, and a burst of pages asking at once shares a single read instead of
  starting one each.
- Rules and page protections now end up in the state you last asked for. Each protection
  checked what it had last applied, made its change, then recorded it -- fine one at a
  time, but two changes close together could both start, and whichever finished last
  won even when it was the older one. So a switch could end up off in the settings and
  on in the browser, or the reverse. Changes to the same protection are now applied
  strictly in the order you made them.
- The certificate warning no longer replaces a page you actually asked for. When a site
  fails its security check, WardenOne reads your settings before showing the warning
  page -- and if you pressed back, or the site sent you somewhere else, or the tab was
  reused in that moment, the warning still landed and took down whatever had arrived in
  the meantime, then recorded it as blocked. It now confirms the tab is still on the
  failed address before doing anything, and quietly stops if it is not.
- Two switches now take effect when you flip them. Deep cryptominer detection and
  "flag junk search results" each load an extra piece of code only while they are on,
  and the check that decides whether anything needs loading did not look at either
  switch. So once anything else had been changed, turning one of these on or off left
  that check seeing no difference, and it stopped before reaching the part that would
  have loaded or unloaded the code. The switch moved and nothing happened.
- Deep cryptominer detection now acts on what it finds. It watches the page itself,
  so before doing anything it waits to hear whether you have WardenOne switched on and
  whether you have allowlisted this site -- and if it started after that message had
  already been sent, it was supposed to ask for it again. It was asking in a place the
  rest of the extension cannot hear: the page side and the extension side run in
  separate worlds and do not share what they can see. The request went nowhere every
  time, so a detector that started late never learned anything, and a page it caught
  mining was left running and never reported. It now asks through the one channel both
  sides genuinely share.
- Memory Shield now actually puts idle tabs to sleep. It measured how long a tab had
  been unused from a note it kept in memory -- and Chrome shuts the extension down
  every few minutes, taking that note with it. The five-minute check that was meant
  to do the sleeping was itself what woke it up again, so on almost every run every
  tab looked like it had just been used, the thirty-minute threshold was never
  reached, and the sweep reported success having done nothing. It now asks Chrome
  when each tab was last looked at, which survives that, and uses whichever answer is
  more recent so a tab you are still using is never counted as idle.
- Memory Shield no longer discards a tab it could not check. Before putting a tab to
  sleep it asks that tab whether you have unsaved typing or a live camera or
  microphone -- but if the tab did not answer, because the extension had just
  reloaded or the page was busy, that silence was read as "checked, and it is empty".
  Sleeping reloads a tab, so that is how a half-written message disappears. Silence
  now counts as unknown, and unknown means the tab is left alone: Free RAM Now tells
  you it kept it because it could not check, and the promise that unsaved work is
  never touched is now one the code actually keeps. The check also waits a little
  longer before giving up, since giving up used to be free and now costs you the
  feature on exactly the busiest tabs.
- Turning Memory Shield off now stops its background work. The five-minute wake-up was
  scheduled whether or not you used the feature, so it kept waking, reading your
  settings, and going back to sleep, forever.
- WardenOne now says when it is the reason a page will not load. Smart Script Shield
  blocks third-party scripts, which is right almost every time and invisible when it
  is -- but when a site genuinely needed one, the page simply failed. A black video
  player, an app stuck on its splash screen, a verification box that never appeared,
  and nothing anywhere naming the feature that did it. The only way out was to already
  suspect the extension, find the Script Shield panel and trust the site by hand. Now,
  if the shield refused something on a page and that page is still blank or stalled a
  few seconds later, a small notice appears in the corner: what was blocked, and a
  button to allow scripts on that site and reload. Both halves have to be true, so an
  ordinary page that had an ad script blocked and works fine stays quiet.
- Made the nine warnings that appear on the page behave like the dialogs they look
  like. The phishing block, the adult-site gate, the redirect-chain and IP-logger
  notices, the tech-support scam lock, the script-drift, permission-chain, new-sign-in
  and OAuth consent warnings all cover the page and ask you to decide something -- and
  none of them said so. A screen reader was never told a security decision had
  appeared, and the keyboard stayed on the page underneath, so you could tab through a
  site you had just been warned about without ever reaching the warning. Each one now
  announces itself, puts the keyboard inside, keeps Tab and Shift+Tab within it, and
  hands focus back where it came from when you close it. Focus starts on the safe
  choice, never on "continue anyway", so a reflex press of Enter cannot wave a phishing
  warning away. The focused button is visible again too -- including in Windows High
  Contrast, where the ring used to disappear.
- Finished making the popup usable without a mouse or a screen. Every remaining
  control now announces what it is: the seven API-key boxes, the search field, the
  link scanner, the file picker, and the three number fields that previously had
  no name at all, not even placeholder text. The settings list also has a real
  heading structure to navigate by, decorative icons are no longer read out, and
  the motion and high-contrast settings your system already has are now respected
  -- keyboard focus stays visible in Windows High Contrast, where it used to
  disappear.
- Made the settings switches usable with a screen reader. All 115 of them were
  announced as "checkbox, not checked" with nothing to say what they controlled:
  the name you can see sits next to each switch rather than inside its label, so
  there was nothing for a screen reader to read out. Every switch now announces
  its name, and 110 of them also read out the explanation underneath.
- Stopped page loads getting slower the longer WardenOne had been used. Every
  frame of every page rebuilt the site lists from scratch at load, re-checking
  hosts that had already been checked when they were saved. On a fresh install
  that cost almost nothing, but the learned-domain list grows on its own as
  blocking does its job, so the work grew with it and there was no setting to
  point at. The lists are now prepared once when they are saved: 80 to 90 per cent
  less work per frame, and the same lists come out the other end.
- Fixed the block counter giving up halfway through a busy page. Two separate
  parts of the extension were each charging the same allowance for every block
  reported, so the real limit was half the intended one: past about 120 blocks in
  a minute the badge quietly stopped counting and those entries never reached
  Activity. A tracker-heavy news front page passes that during a single load, so
  the pages doing the most work were the ones being undercounted.
- Refused to install on Chrome versions the blocklist cannot work on. The dynamic
  blocklist needs the 30,000-rule ceiling Chrome added in 121; below that the
  limit is 5,000 and the rules silently never apply, so the extension looked
  healthy while blocking nothing. Chrome now declines the install instead of
  letting it fail quietly.
- Stopped WardenOne logging its own errors into other sites' consoles. Every
  message it sent to itself without reading the result left an error behind when
  the background worker happened to be asleep, and the ones sent from the page
  guard landed in whatever site you were on. Anyone with the console open on
  their own site saw WardenOne throwing.
- Kept the first few blocks after a wake-up in Activity. The log recovers
  anything unsaved when the background worker restarts, but it was overwriting
  whatever had arrived in the meantime -- which is exactly the block that woke it
  up in the first place.
- Made the popup's status text readable. Error, warning and secondary text was
  too light against the panels it sits on -- the "could not reach the breach
  database" line, the extension-review list and the session grade all fell below
  the contrast level text needs to be legible, and the worst of them was less
  than half of it. Every colour that carries text is now dark enough on every
  surface it can land on, and the faint/soft/solid text steps still read as three
  distinct levels rather than collapsing into one.
- Stopped settings quietly reverting when something else changed them while the
  popup was open. The popup kept its own copy of every setting for as long as it
  was open and wrote that whole copy back on each change, so anything altered in
  the meantime was undone — running Repair and then flipping one switch put the
  settings Repair had just cleaned up straight back. It now re-reads your saved
  settings at the moment it writes and only changes the ones you actually
  touched, and it picks up changes made elsewhere instead of showing you a value
  that is no longer true.
- Stopped "Suspicious site behavior" firing on everyday sites. Loading a
  cross-site asset before your first click and measuring the canvas is what
  every large site does, so those signals no longer raise a warning on their
  own; a site's own asset host (x.com to twimg.com, or any `assets.<same-site>`)
  counts as first-party; and the reputable-site list is now matched on the
  registrable domain, which both adds the sites people actually use and stops a
  lookalike like `google.com.<attacker>.cfd` being trusted for containing a
  brand name.
- Held the behavioural verdict until the domain-age answer arrives, so an
  established domain is no longer warned about because the lookup came back
  after the warning had already fired.
- Closed intermittent Twitch pre-roll and mid-roll leaks by starting a clean
  alternate stream from Twitch's current ad warning before the native media
  poll, bootstrapping replacement workers with the active V2 master, and
  recovering part-only ad deltas through a bounded complete or clean playlist.
- Neutralized Twitch's current GraphQL video/display creative response and the
  dated VAST fetch/XHR endpoints before a full-player pre-roll can render.
- Answered Twitch's current video-ad preflight with its recognized decline
  result so non-forced client ads leave through the player's normal reset path.
- Replaced the unreliable embed-only warm-up with a bounded popout/mobile-web
  race, and treated authoritative Twitch pre-roll metadata as an ad even when
  its media segment is misleadingly titled `live`.
- Kept Twitch master snapshots and ad warnings channel-scoped across rapid SPA
  switches, re-resolved late player mappings after low-latency retries, and
  neutralized worker-originated creative responses before they can render.
- Removed current Stream Display, squeezeback, companion, and independent video
  creatives while restoring the genuine live player to its full layout.
- Kept ad-time low-latency HLS transitions internally consistent and cleared
  intervention state during fail-open recovery to prevent black screens,
  repeated stalls, and error 2000/3000 loops.
- Kept Twitch playback continuous across background-tab ad transitions without
  weakening native hidden-tab safety checks, and excluded trusted media sites
  from the generic background-video throttle.
- Made Twitch worker replacement fail open when the original worker cannot be
  read, cleaned up terminated workers, reference-counted concurrent player
  interventions, and aimed stall recovery at the identified live video.
- Added bounded Twitch playback recovery for network/decode failures so ad
  interception fails open instead of leaving error 2000/3000, a black player,
  or a reload loop.
- Preserved Twitch low-latency HLS semantics and native playback requests while
  keeping confirmed ad-segment handling local to the browser.
- Split the popup guard from the full page engine so embedded players receive a
  small all-frame popup defence without the invasive top-frame feature bundle.
- Made the strict ad-popup shield the fresh-install default, while keeping
  explicit user opt-outs and login/OAuth flows intact.
- Prevented overlay cleanup, tracker learning, and network scriptlets from
  treating player frames, controls, or shared streaming infrastructure as ads.
- Made Verify & Repair follow the same frame boundaries as the manifest.
- Added a general player-safe mode for watch/embed routes: cosmetic rules,
  procedural removals, and every list-driven scriptlet now fail open while the
  dedicated popup guard stays active.
- Added failure-driven Smart Script Shield recovery for streaming players:
  after a fresh trusted player interaction, the failed script host family is
  retried under a tab-local replacement rule. If a second correlated failure
  survives that retry after a new player interaction, a bounded exact-script-path
  and initiator-scoped exception is used below site-control and security priority.
- Added bounded player detection for Video.js, JW Player, Plyr, Shaka, Clappr,
  DPlayer, and ArtPlayer, including delayed and single-page-app player startup.
- Made blocked player popups return a short-lived, non-navigable compatibility
  handle so ad-gated embeds continue loading instead of freezing on a spinner.
- Neutralized cross-site popup links layered over a player and preserved the
  underlying play/server-control activation.
- Kept hidden-autoplay protection away from media inside recognized player
  shells so zero-size initialization no longer pauses legitimate video.
- Fixed mixed-action consent dialogs so an unrelated account control no longer
  suppresses an otherwise explicit reject-all / accept-all choice.
- Refined sensitive-request detection so opaque verification responses and
  ordinary request identifiers remain functional while stored tokens, JWTs,
  credential-labelled fields, and authorization headers stay protected.
- Quieted behavioral and fingerprint notices only while a structurally visible
  browser-verification challenge is present; request protections remain active.

### Added

- Clear the cookies that pile up without being signed out of everything. Every
  "accept all" you have ever clicked leaves a cookie behind, and the ad networks
  leave several more, and they sit there for years. Clearing cookies got rid of
  them -- along with every login you had, which is why nobody does it. There is now
  a separate option that removes only the consent-banner and tracking cookies and
  leaves the rest alone. It works from a list of names WardenOne recognises, so
  anything it has not heard of is kept: the worst it can do is miss a banner, never
  sign you out. It tells you afterwards how many it removed and how many it kept.
- Clear the camera, microphone and location permissions sites have collected. You
  allow one for a video call or a map and it stays allowed forever, because nothing
  ever brings it up again. This hands them all back to "ask", so a site that really
  needs your camera will simply ask you next time. Chrome does not let an extension
  list which sites hold a permission, so this clears them rather than showing you a
  list -- and it resets to ask, never to blocked.
- A time range on the privacy cleaner. It used to clear everything since the
  beginning of time whatever you picked; you can now choose the last hour, day,
  week or month instead.

- A guide to getting your own API keys, linked at the bottom of the popup. The extra
  checks WardenOne can do -- scanning a download against about seventy antivirus
  engines, checking a site against live phishing feeds -- need keys from the services
  that run them, and they are free. The page explains what each one adds, why you would
  want it, and how to go and get it. None of them are required and the built-in
  protection does not use them.
- More than a hundred more software makers recognised by name, so downloads from them
  stay quiet: antivirus companies, browsers, Slack and Telegram and Zoom, GIMP and
  Blender and LibreOffice, Steam and GOG and the game studios, printer and graphics-card
  drivers, the Linux distributions, and the utilities people are told to install.

- Cryptojacking guard (on by default). Drive-by mining services are blocked on
  every resource type, and pages are blocked from reaching mining pools over
  WebSocket, XHR, or script. Mining pools are only blocked as a third-party
  connection, so visiting a pool or using its dashboard still works -- a site
  just can't mine through one behind your back.
- Optional deep cryptominer detection, off by default, for the case blocking
  cannot see: a miner a site hosts on its own origin. It reads the source of the
  workers a page starts and stops the ones running mining routines, including the
  replacements a miner spawns when its workers are killed. Only the matching
  worker is stopped, so a site that also runs a legitimate worker keeps it, and a
  miner that overwrites `terminate()` cannot save itself. It is only registered
  while switched on, so leaving it off costs nothing.

  Nothing is stopped until the extension has told the page whether the site is
  allowlisted. A worker's source resolves from memory faster than that answer
  arrives, so acting on arrival would have killed workers on allowlisted sites.
  On an allowlisted site the miner is reported and left running.

  It deliberately does not judge by CPU load. Measured against a spinning worker
  on every core of a 12-core machine, a main-thread benchmark moved 1.03-1.21x,
  a probe worker 1.63x but only against a baseline taken before the miner starts,
  and a baseline-free worker-versus-main ratio 1.21x. Every variant either could
  not fire or fired on anything busy, and none could tell mining apart from a
  video export. So heavy CPU use is not reported as mining.

- Optional SafeSearch enforcement, off by default. Locks Google, Bing,
  DuckDuckGo, Brave Search and Yahoo into SafeSearch and YouTube into Restricted
  Mode.
  The adult-site gate only fires on arrival at a site, so explicit images and
  video inside a results page were never something it could catch -- you never
  leave the search engine. Off by default because it changes what search shows
  you.

- Optional search-junk marker, off by default. Dims and labels results from sites
  that rank by republishing other people's answers -- Stack Exchange and GitHub
  scrapers -- on the Google, Bing, DuckDuckGo, Brave Search and Yahoo results
  pages.

  It marks and never removes, and that is the whole design. Ad blocking fails
  visibly: block a real image and you see a gap. Search filtering fails invisibly:
  hide the one result that answered the question and the user never learns it
  existed, they just think the web got worse. So every match keeps a one-click
  "Show anyway", and an allowlisted search engine is skipped entirely.

  It anchors on result links rather than result-block class names, because Google
  randomises those and reshuffles its DOM constantly; a link has to carry its
  destination host or the result would not work. Where the walk up to a result
  block fails, the result is left alone. A bundled seed works offline and on day
  one, and the existing daily list refresh extends it from quenhus's
  uBlock-Origin-dev-filter, under the same caps and drift protection as the other
  supplemental lists. That project's bare-domains output is used rather than its
  uBlock-syntax one, whose cosmetic half encodes Google's DOM.

- Optional "plain web results only" for Google, off by default. Switches Google
  into its own Web mode (udm=14) -- ten blue links, no AI overview, no enriched
  panels. Removing the clutter at the source beats hiding it after paint: nothing
  can flash in first, and there is no selector to go stale when Google reshuffles
  its markup.

  Google's Images, Videos and News tabs are udm values too, so the parameter is
  only ever added when the URL has none, never replaced -- otherwise clicking
  Images would bounce you straight back to Web and you could never leave. A DNR
  condition cannot express "this parameter is absent", so that is handled with
  rule priority: when SafeSearch is also on, a higher-priority rule claims every
  URL that already carries a udm and adds only the SafeSearch parameter, leaving
  the lower rule to see nothing but URLs without one.

- Settings export and import. There is no account and nothing syncs, so a
  reinstall previously meant rebuilding every setting by hand. Provider API keys
  are stripped from the export by pattern rather than by a list, so a provider
  added later is covered automatically, and the same rule blocks them on import
  so a hand-edited file cannot inject a key. Imported values are matched against
  the shape of the shipped default for each setting; unknown keys, wrong types
  and oversized lists are dropped rather than trusted.

### Quality

- Added popup, streaming, Twitch fail-open, network-policy, and compatibility
  regressions to the maintainability suite.
- Ran the security posture check and the OAuth guard tests as part of the
  maintainability gate. Both existed but neither was executed, so a regression
  in the extension-page CSP, the permission set, the HTML-sink rules, or the
  consent-grant scoring could have landed without turning the gate red.
- Corrected and expanded third-party licensing and attribution notes.

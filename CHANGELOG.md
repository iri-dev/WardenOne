# Changelog

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
  a full-player creative hours or days later. A clean alternate stream now starts its
  two playable edge choices before Twitch receives the replacement playlist, then
  hands the player's matching request the already-started response instead of making
  it download the same segment again. Fragmented-MP4 streams do the same for their
  decoder init map. Unused work is bounded and cancelled on a channel or setting
  change, ranged media stays native, and none of this changes quality, seeking,
  pausing or the playlist response deadline.
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

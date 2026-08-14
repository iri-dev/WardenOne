# Changelog

## 1.0.0 — 2026-07-29

First public-release hardening pass.

### Fixed

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

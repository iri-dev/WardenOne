# One purpose: the Store package

Chrome's Web Store asks for one narrow purpose and for clearly separate functions to be separate
extensions. The Store package describes WardenOne as protective browsing with reader-controlled
page presentation and resource use:

> **WardenOne helps readers browse with more control: it blocks threats and trackers, defends
> privacy, warns about risky actions, offers optional page display controls for readability,
> and releases resources held by eligible idle tabs.**

The decisions below define the proposed Store scope. The GitHub build carries all four
utilities. Chrome Web Store approval remains subject to Google's review.

## The decision

The earlier package removed four features. **EyeShield** has a case for inclusion: its optional
brightness, contrast, warmth, saturation and grayscale controls let a reader adjust pages for
readability and visual comfort, including readers with low vision or light sensitivity. These
controls are described plainly in the Store listing; no claim that they prevent eye disease or
vision loss is made.

**Memory Shield** has a case for inclusion as resource protection: it uses Chrome's tab discard
mechanism to release RAM held by eligible idle tabs, while checking for unsaved forms and active
media and preserving pinned, audible, login and payment tabs under the reader's settings. This
can reduce background resource use, but it does not promise a specific CPU or RAM saving.
**Tab Limit** belongs to the same feature: its default is off; when enabled, it sleeps an
eligible idle tab at the chosen cap, and closing instead requires a separate opt-in. These
controls can also help offset WardenOne's own resource cost. Resource Saver's autoplay, prefetch,
background throttling and lazy-media settings serve the same resource-protection purpose.

The policy case is reader-controlled protective browsing. Memory Shield limits resources spent
on unused tabs, and Tab Limit is a control inside that module and popup section. The listing
names both so users know what the extension may do to their tabs.

**Twitch Rewind has a strong viewer-control case.** Twitch's own
[Stream Rewind](https://help.twitch.tv/s/article/stream-rewind) is currently limited to eligible
subscribers on channels where the broadcaster enables it. WardenOne's opt-in local DVR buffers
only the stream already playing in the current tab, keeps that recording in bounded local memory,
and uploads none of it. It cannot recover footage from before the tab started watching. Its
separate VOD rewind button uses an available in-progress Twitch VOD in Twitch's own player; it
does not make a recording. Pausing, revisiting a missed moment and
resuming a live broadcast are ordinary playback controls. The local DVR also uses substantial
RAM and CPU, which its popup discloses.

The possible Store argument is that WardenOne gives readers control over what happens in their
browser, including media they have chosen to watch. The single-purpose risk is substantial:
live-stream playback is an entertainment function distinct from threat, privacy, readability and
resource protection. Chrome's [single-purpose guidance](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)
allows related functions in one narrow focus area but asks for clearly separate functions to be
separate extensions. The proposed Store profile therefore omits both rewind modes while the full
GitHub build keeps them. A separate, narrowly described Twitch rewind extension would make the
clearest Store case if Store distribution of this feature becomes a goal. A reviewer may also see
EyeShield or Memory Shield as separate purposes.

- **The Store package includes EyeShield, Memory Shield and Tab Limit, and omits Twitch Rewind.**
  For Twitch Rewind, it removes the files, manifest entries, settings, controls, permissions
  copy and integrity expectations. `tools/build-store-package.js` builds that package from the
  committed tree with git's own plumbing, so the same commit always yields the same bytes. The
  build refuses dangling references to files it removed.
- **The GitHub build is unchanged.** The repository carries all four utilities.
- **The Store package strips the omitted utility's code and copy.** `build-profile.js` tells the
  worker and popup which package they are in. The Store package loads Memory Shield, keeps Tab
  Limit controls and tab actions, and registers EyeShield. Guards let a build without a module
  start cleanly and report "not in this build". The integrity check does not ask for files a
  package lacks. In the full build the omitted list is empty.

The publisher decision lives in the `store` field of each feature in `build-profile.js`.
`include` carries the feature into the Store package; `omit` removes it. The gate
(`node tools/build-store-package.js --check`) fails if the table names
a file or a setting that does not exist, if a guard the package relies on is missing, if the
popup has an unmarked section, if this page is stale, or if a dry-run build leaves a dangling
reference.

To build the package:

```bash
node tools/build-store-package.js --out WardenOne-store.zip
```

Nothing is submitted by any tool here. Whether to submit at all, and when, stays a decision made
by a person, with this page in front of them.

## The separable utilities

<!-- BEGIN GENERATED FEATURE TABLE -->

_Generated by `tools/build-store-package.js --doc` from the `features` table in `build-profile.js`._
_Do not edit this block by hand; the gate rebuilds and checks it._

| Utility | Store decision | Its goal | Files omitted | Settings omitted |
| --- | --- | --- | --- | --- |
| EyeShield (`eyeShield`) | Included | Reader-controlled page presentation for readability and visual comfort: brightness, contrast, warmth, saturation and grayscale. | — | — |
| Memory Shield (`memoryShield`) | Included | Resource protection: discard eligible idle tabs to release RAM, with safeguards for active work and media; find duplicate and long-idle tabs. | — | — |
| Tab Limit (`tabLimit`) | Included | Memory Shield control: when an optional tab cap is reached, sleep an eligible idle tab or close one if the reader opts in. | — | — |
| Twitch Rewind (`twitchRewind`) | Omitted | Local replay of a live Twitch stream: a rewind buffer and a jump to the in-progress recording. | `twitch-rewind.js`, `twitch-vod-rewind.js` | `twitchRewind`, `twitchRewindMinutes`, `twitchVodRewind` |

<!-- END GENERATED FEATURE TABLE -->

Memory Shield's *Resource Saver* rows (block autoplay, throttle background tabs, block prefetch,
lazy-load media) also stay in the Store package. These controls limit work a page does in the
background. A reviewer may weigh them differently; they are named here for a complete review.

## Every section of the popup, against the sentence

The check that keeps this table honest is mechanical: every `<h2>` in `popup.html` must have a
row here, so a section cannot be added without saying how it answers the sentence.

| Section | How it delivers the purpose |
| --- | --- |
| Script Shield | Decides which scripts a page may run and limits third-party script reach: blocking a threat before it acts. |
| Redirects & popups | Stops forced navigations, popup tricks and redirect chains the reader did not ask for. |
| IP protection | Closes WebRTC address leaks and blocks IP-logger endpoints: privacy. |
| Download Shield | Reviews a download's source and reputation before it is kept: threat protection. |
| Privacy | Blocks trackers and fingerprinting, strips tracking identifiers, sends Global Privacy Control: privacy. |
| AdShield | Filters advertising and tracking requests and elements, the largest tracking and malvertising surface on the web. The Twitch Rewind block that sits inside this section in the GitHub build is a separable utility and is omitted from the Store package. |
| Memory Shield | Releases RAM held by eligible idle tabs, offers safeguards for active work and media, and includes Tab Limit as an optional resource control. Resource Saver rows limit background work. These functions are disclosed in the listing; their single-purpose fit remains a reviewer judgment. |
| Forget Me & Logins | Clears a site's data when you leave it and warns about sign-ins on newly registered domains: privacy and threat protection. |
| Media Shield | Refuses camera, microphone and screen capture a page starts without you, and hidden background media: protection against abuse of device access. |
| Adult-site safety | Gates adult sites and enforces safe search: content protection chosen by the reader. |
| Advanced detection (catches rotating/custom domains) | Phishing, scam and fake-update heuristics that work without a list: threat protection. |
| SessionShield — login & session protection | Stops tokens, passwords and card numbers leaving a page for a stranger, and watches for skimmers: protection of credentials. |
| Blocklist (auto-updating) | The threat, tracker and ad lists the network layer enforces, and their update schedule. |
| EyeShield | Optional brightness, contrast, warmth, saturation and grayscale controls let readers adjust page presentation for readability and visual comfort. This is disclosed in the listing; the single-purpose fit remains a reviewer judgment. |
| What WardenOne watches | The watch-only guards that record device-access and capability probes without changing a page: protection evidence. |
| Interface | How WardenOne shows itself -- badge, toasts, silent mode. Presentation of the protection, not a feature of its own. |
| Settings backup | Export and import of WardenOne's own settings. Housekeeping for the extension itself. |
| Privacy cleaner | Clears browsing data, consent and tracking cookies and site permissions: privacy. |
| This site | Per-site pause, allowlist and per-protection switches for the page in front of you. Control of the protection, not a feature of its own. |

# Manifest permission audit

Audit date: 28 September 2026. Scope: the current local MV3 build, its 18 named permissions and its whole-web host scope. This records what shipped code actually uses. It is a permissions design record, not a Chrome Web Store approval claim.

Chrome distinguishes required from optional permissions. An optional permission must be declared and requested during a user action; denial must leave the feature off or clearly reduced. See [Chrome's permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [permission declaration guide](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions).

## Named permissions

| Permission | Code and feature using it | Decision |
| --- | --- | --- |
| `declarativeNetRequest` | `background.js` updates static, dynamic and session blocking rules for network shields. | **Required.** Automatic filtering depends on it; Chrome does not allow this permission to be optional. |
| `declarativeNetRequestFeedback` | `background.js` reads matched rules for `logger.js`; no blocking decision depends on the feedback. | **Currently required; optional candidate.** The Logger needs a grant-aware handshake and honest fallback before this can move. Chrome documents exact rule debug events for unpacked extensions, so packaged behavior also needs a real-browser check. |
| `storage` | `background.js`, `popup.js` and other pages hold configuration, list state, local history, and extension review state. | **Required.** Shields and their settings need it on startup. |
| `activeTab` | Popup tools such as Element Zapper call `chrome.scripting.executeScript`; popup and command actions also read current-tab metadata. Broad host access already covers these operations on matching pages. | **Retained pending compatibility review.** The October browser matrix found no separate dependency in the cases tested, including toolbar invocation with site access withheld. |
| `scripting` | `background.js` registers and repairs page shields; `popup.js` injects user-invoked tools. | **Required.** Automatic page protection and repair use it. |
| `webRequest` | `background.js` observes request, redirect and failure signals and captures Logger rows while its page is open. | **Required.** Automatic network detection uses it. |
| `webNavigation` | `background.js` follows navigation and redirect chains, tab changes and on-leave cleanup. | **Required.** Automatic navigation protection uses it. |
| `alarms` | `background.js` and worker modules schedule feed refresh, retries, reconciliation and Memory Shield work. | **Required.** Protection upkeep must work without a popup open. |
| `browsingData` | `background.js` powers manual privacy clearing, Forget Me's opted-in storage wipe, service-worker cleanup and cache cleanup after blocking a site. | **Required today; optional candidate.** A migration must request access at every manual action and before enabling either automatic cleanup path, then handle imported settings and revocation. Moving only the manifest entry would silently weaken cleanup. |
| `cookies` | `background.js` powers manual cookie inspection/cleanup, Forget Me and opted-in on-leave consent-cookie cleanup. | **Required today; optional candidate.** Request at enablement and manual actions, then gate every background cleanup on the live grant. |
| `history` | `background.js` uses `chrome.history.search/deleteUrl` only for Forget Me's separate “Also clear the site's browser history” switch. | **Optional now.** `popup.js` requests it when that switch is turned on. Denial leaves history untouched; the worker checks the live grant before each wipe, and the popup clears stale saved state if access was revoked. |
| `management` | `background-extension-watch.js` and `background-extension-reputation.js` watch installed-extension changes; `extensions.js` handles requested disable/uninstall. | **Required.** The automatic extension-change guard needs its inventory and events before the Security Centre is opened. |
| `contentSettings` | `background.js` controls Script Shield lockdown and site exceptions and implements the site-permission scanner and reset. | **Required today; optional candidate.** Lockdown and saved exceptions need a reliable grant before setting or repairing browser-wide JavaScript rules; denial and revocation need a visible degraded state. |
| `contextMenus` | `background.js` installs right-click checks and page tools. | **Keep declared.** These are visible, user-invoked entry points; the permission itself does not grant page-data access. Deferring the menus would add complexity without reducing whole-web host access. |
| `downloads` | `background-downloads.js` watches new downloads and drives Download Guard review. | **Required.** A runtime prompt would miss downloads started before it was granted. |
| `notifications` | `notification-manager.js` and extension-change code show local threat and security notices. | **Required.** Automatic alerts cannot wait for a popup grant. |
| `offscreen` | `notification-manager.js` briefly opens `offscreen.html` to play enabled alert sounds. | **Required today; optional candidate.** Sounds are optional, but the permission should move only with a prompt when sound is enabled and a silent fallback for denied or revoked access. |
| `tabs` | `chrome.tabs.query/get` supply URLs and titles to Memory Shield and `findDuplicateTabs()` even when the tab is outside a current host grant. | **Keep.** Removing it loses duplicate-tab detection when site access is withheld, plus metadata for browser pages. Opening, closing or sleeping a tab does not itself justify this permission. |

## Host scope

`<all_urls>` remains a required `host_permissions` entry. `background.js` uses host access for cross-origin feeds, reputation and security requests, network observations and programmatic injection; manifest content scripts also match `<all_urls>` for automatic page protection. Making that scope optional would turn whole-web shielding into a per-site grant workflow. Chrome can still withhold site access at the browser level, so the UI must keep reporting coverage limits accurately. No optional host scope was added by this audit.

## Focused tab-permission review — 19 October 2026

`tools/browser-tab-permissions.js` tested the shipped extension in four disposable copies and fresh Chrome 155.0.8059.82 profiles on Windows. Only the copies' named permissions changed. It exercised real tab metadata, `findDuplicateTabs()`, and `chrome.scripting.executeScript` before and after a toolbar action with Chrome site access set to **On click**.

| Removed from the test copy | Injection with broad site access | Browser-page URL visible | Duplicate scan with site access withheld | Injection after toolbar action |
| --- | --- | --- | --- | --- |
| Neither | Works | Yes | Finds duplicate | Works |
| `activeTab` | Works | Yes | Finds duplicate | Works |
| `tabs` | Works | No | Misses duplicate | Works |
| Both | Works | No | Misses duplicate | Works |

The [Tabs API reference](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions) distinguishes the named permission's metadata access from permission-free tab operations and matching host grants. These results establish a dependency for the shipped duplicate scanner when host access is withheld. They also correct the earlier assumption that a toolbar invocation in that state proves `activeTab` is necessary: it worked without the named permission in this browser.

Both declarations remain in the working manifest. `activeTab` remains a removal candidate pending wider compatibility validation; this matrix does not exercise every popup, shortcut and context-menu workflow or the supported browser range starting at Chrome 121. Its unique necessity has not been established.

## Migration order and release checks

1. **Done locally:** Move only `history` to `optional_permissions`; request it from the switch's user gesture and keep cookie/storage Forget Me behavior independent of history denial. Test grant, denial, revocation and the worker's live-permission check.
2. **Next candidate:** Make Logger-only `declarativeNetRequestFeedback` optional after its worker and page both check the live grant. Verify the exact and correlated rule messages in an unpacked build and a packaged build. The [DNR API reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) limits `onRuleMatchedDebug` to unpacked extensions and conditions `getMatchedRules` on feedback or a granted `activeTab` for a specified tab.
3. **Later candidates:** `browsingData`, `cookies`, `contentSettings` and `offscreen` need feature-specific prompts, upgrade handling and revocation paths before any manifest move. Preserve their automatic behavior for users who enable those features.

Do not turn a permission off merely because an API call fails. The UI should identify the unavailable feature, while unrelated shields continue running.
